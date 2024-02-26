const OpenAPIParser = require("@readme/openapi-parser");

import { pascalCase, camelCase, snakeCase } from 'change-case';
import { createFile, truncate, appendFile, readFile } from 'fs-extra';

const usageText = `Usage npm run generate [ "<path-to-api-spec>" [ "<java-package-name>" [ "<app-name>" ] ] ]`;

const indent = '    ';
const xEntityRefKeyName = 'x-entity-ref';
const xEntityRelKeyName = 'x-entity-relationship';
const xSkipPersistenceKeyName = 'x-skip-persistence';
const xRequiredKeyName = 'x-required';
const xParentFieldName = 'x-parent-field-name';
const xPackageName = 'x-package-name';
const newLine = '\n';
const relOneToMany = 'one-to-many';
const relOneToOne = 'one-to-one';
const relManyToOne = 'many-to-one';
const relManyToMany = 'many-to-many';

const typeString = 'string';
const typeNumber = 'number';
const typeInteger = 'integer';
const typeObject = 'object';
const typeArray = 'array';
const typeBoolean = 'boolean';

async function processOpenApiSpec(pathToApiSpec: string, packageName: string, baseName: string, pathToOutputJdl: string) {
    if (pathToApiSpec === undefined || pathToApiSpec === '' || packageName === undefined || packageName === '' || baseName === undefined || baseName === '') {
        throw new Error(usageText);
    }
    
    const api = await OpenAPIParser.parse(pathToApiSpec);
    const fileName = pathToOutputJdl;
    await createFile(fileName);
    try {
        truncate(fileName);
    } catch (error) {
        console.error(error);
    }

    var appConfig = `application {
    config {
        baseName ${baseName}
        applicationType microservice
        packageName ${packageName}
        authenticationType jwt
        devDatabaseType h2Disk
        prodDatabaseType postgresql
        skipUserManagement true
        skipClient true
        testFrameworks [cucumber]
        buildTool maven
        cacheProvider no
        databaseType sql
        enableHibernateCache true
        enableSwaggerCodegen false
        entitySuffix Entity
        languages [en, es]
        nativeLanguage en
    }
    entities *
}
    
`;

    try {
        appConfig = await readFile('partials/app_config.jdl', 'utf8');
    } catch(error) {}

    var jdlOptions = `
// Set pagination options
paginate * with pagination

// Use Data Transfer Objects (DTO)
dto * with mapstruct

// Set service options to all except few
service all with serviceImpl

// Set filter option
filter *
        
`;

    try {
        jdlOptions = await readFile('partials/global_options.jdl', 'utf8');
    } catch(error) {}

    await appendFile(fileName, `${appConfig}
${jdlOptions}`);

    const schemas = api.components.schemas;
    const enumerations: { [key: string]: Entity; } = {};
    const simpleTypeModels: { [key: string]: Entity; } = {};
    for (const [schemaName, entity] of Object.entries<Entity>(schemas)) {
        if (entity.type === typeString && entity.enum) {
            enumerations[pascalCase(schemaName)] = entity;
        } else if ([typeString, typeNumber, typeBoolean].includes(entity.type!)) {
            simpleTypeModels[pascalCase(schemaName)] = entity;
        }
    }

    for (const [schemaName, entity] of Object.entries<Entity>(schemas)) {
        if (entity.type === typeObject && !Object.keys(entity).includes(xSkipPersistenceKeyName) && !isSkippableSchema(pascalCase(schemaName))) {
            await appendFile(fileName, await generateEntity(schemaName, entity, enumerations, simpleTypeModels, schemas));
        }
    }

    // Add enumerations to end of file
    for (const [enumName, enumObj] of Object.entries(enumerations)) {
        await appendFile(fileName, await generateEnum(enumName, enumObj));
    }
}

function getSchema(schemaNameQuery: string, schemas: any) {
    for (const [schemaName, entity] of Object.entries<Entity>(schemas)) {
        if (schemaNameQuery === schemaName) {
            return entity;
        }
    }
    return undefined;
}

function collectRefProperties(entity: Entity, schemas: any): {} {
    var properties = {};
    if (entity.allOf) {
        properties = {...gerRefListProperties(entity.allOf, schemas)};
    }
    if (entity.anyOf) {
        properties = {...gerRefListProperties(entity.anyOf, schemas)};
    }
    if (entity.oneOf) {
        properties = {...gerRefListProperties(entity.oneOf, schemas)};
    }
    return properties;
}

function gerRefListProperties(refList: [{ [key: string]: string | Entity; }], schemas: any) {
    var properties = {} as { [key: string]: Property; };

    for (const [, value] of Object.entries<any>(refList)) {
        if (value['$ref']) {
            const reference = value['$ref'];
            const refEntityName = reference.substring(reference.lastIndexOf('/') + 1);
            const entity = getSchema(refEntityName, schemas);
            
            if (entity?.properties) {
                for (const [propName, property] of Object.entries<Property>(entity?.properties!)) {
                    properties[propName] = property;
                }
            }
        } else if (value['properties']) {
            properties = {...properties, ...value['properties']};
        }
    }
    return properties;
}

async function generateEntity(schemaName: string, entity: Entity, globaleEnumerations: { [key: string]: Entity; }, simpleTypeModels: { [key: string]: Entity; }, schemas: any) {
    var properties = entity.properties;

    var inheritedProps = collectRefProperties(entity, schemas);
    if (properties) {
        properties = {...properties, ...inheritedProps}
    } else {
        properties = inheritedProps;
    }

    var propString = '';
    var enumerations = '';
    var oneToManyRelations = [];
    var manyToManyRelations = [];
    var oneToOneRelations = [];
    var manyToOneRelations = [];
    var relations = '';
    var entityDescription = '';
    const schemaNamePascalCase = pascalCase(schemaName);
    const schemaNameCamelCase = camelCase(schemaName);

    // Add ID key field
    propString += `${indent}@Id${newLine}${indent}uuid String${newLine}${newLine}`;

    for (const [propName, property] of Object.entries<Property>(properties)) {
        if (isSkippableProperty(property, propName)) {
            continue;
        }

        // x-entity-ref is used to reference the entity type an ID refers to, e.g., if we have ledger_account_id,
        // then value assigned to the corresponding field should refer to a ledger account that exists in the database.
        const hasXEntityRef = getAdhocPropertyProperty(xEntityRefKeyName, property);
        const ormRelFilterRes = Object.entries(property).filter((val) => val[0] === xEntityRelKeyName);
        const ormRelationship = ormRelFilterRes && ormRelFilterRes.length > 0 ? ormRelFilterRes.map(val => val[1])[0] : undefined;

        // Indicates whether a relationship is required internally
        const xRequired = getAdhocPropertyProperty(xRequiredKeyName, property);

        // Process property that doesn't reference another entity
        if (isTypedProperty(property) && !hasXEntityRef) {
            if (property.type !== typeArray && property.type !== typeObject) {
                var propType = mapPropertyType(property, propName, entity);
                if (property.type === typeString && property.enum) {
                    const enumName = `${schemaNamePascalCase}${pascalCase(propName)}`;
                    propType = enumName;
                    enumerations += generateEnum(enumName, property) + newLine;
                }

                if (property.description) {
                    propString += `${indent}/** ${property.description} */${newLine}`;
                }
                propString += `${indent}${camelCase(propName)} ${propType}${newLine}${newLine}`;
            } else if (propName !== 'components') {
                if (property.type === typeArray && property.items && property.items['$ref']) {
                    const reference = property.items['$ref'] as string;
                    const refEntityName = reference.substring(reference.lastIndexOf('/') + 1);
                    const parentFieldName = getAdhocPropertyProperty(xParentFieldName, property);
                    if (ormRelationship === undefined || ormRelationship === relOneToMany) {
                        oneToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}${parentFieldName ? '{' + camelCase(parentFieldName) + '}' : ''}${newLine}`);
                    } else if (ormRelationship === relManyToMany) {
                        manyToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}{${schemaNameCamelCase}}${newLine}`);
                    }
                }
            }
        // Process property that references an OAS3 model
        } else if (property.$ref && !hasXEntityRef) {
            const reference = property.$ref;
            const refEntityName = reference.substring(reference.lastIndexOf('/') + 1);

            // Don't reference enums in relationships
            if (!globaleEnumerations[refEntityName] && !simpleTypeModels[refEntityName]) {
                if (ormRelationship === relOneToMany) {
                    oneToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}${newLine}`);
                } else if (ormRelationship === relManyToMany) {
                    manyToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}{${schemaNameCamelCase}}${newLine}`);
                } else if (ormRelationship === relOneToOne) {
                    oneToOneRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
                } else if (ormRelationship === relManyToOne || ormRelationship == undefined) {
                    manyToOneRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
                }
            } else if (simpleTypeModels[refEntityName] !== undefined) {
                const propType = mapPropertyType(simpleTypeModels[refEntityName], propName, entity);
                const refEntity = simpleTypeModels[refEntityName];

                if (refEntity.description) {
                    propString += `${indent}/** ${refEntity.description} */${newLine}`;
                }
                propString += `${indent}${camelCase(propName)} ${propType}${newLine}${newLine}`;
            } else {
                // const refEnum = globaleEnumerations[refEntity] as Entity;
                // if (refEnum.description) {
                //     propString += `${indent}/** ${refEnum.description} */${newLine}`;
                // }
                propString += `${indent}${camelCase(propName)} ${refEntityName}${newLine}${newLine}`;
            }
        // Process property that references another entity
        } else if (hasXEntityRef) {
            const refEntityName = hasXEntityRef.substring(hasXEntityRef.lastIndexOf('/') + 1);
            const modifiedPropName = propName.replace('_id', '');

            if (ormRelationship === relOneToMany) {
                const parentFieldName = getAdhocPropertyProperty(xParentFieldName, property);
                oneToManyRelations.push(`${schemaNamePascalCase}{${camelCase(modifiedPropName)}} to ${refEntityName}${parentFieldName ? '{' + camelCase(parentFieldName) + '}' : ''}${newLine}`);
            } else if (ormRelationship === relManyToMany) {
                manyToManyRelations.push(`${schemaNamePascalCase}{${camelCase(modifiedPropName)}} to ${refEntityName}{${schemaNameCamelCase}}${newLine}`);
            } else if (ormRelationship === relOneToOne) {
                oneToOneRelations.push(`${schemaNamePascalCase}{${camelCase(modifiedPropName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
            } else if (ormRelationship === relManyToOne || ormRelationship == undefined) {
                manyToOneRelations.push(`${schemaNamePascalCase}{${camelCase(modifiedPropName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
            }
        // Process property that inherits from another
        } else if (property.allOf && property.allOf.length > 1) {
            const refEntry = property.allOf.find(val => val['$ref']) as { [key: string]: string; };
            const reference = refEntry['$ref'];
            const refEntityName = reference.substring(reference.lastIndexOf('/') + 1);

            const entityRelEntry = property.allOf.find(val => val[xEntityRelKeyName]) as { [key: string]: string; };
            const entityRel = entityRelEntry[xEntityRelKeyName];

            if (entityRel === relOneToMany) {
                const parentFieldName = getAdhocPropertyProperty(xParentFieldName, property);
                oneToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}${parentFieldName ? '{' + camelCase(parentFieldName) + '}' : ''}${newLine}`);
            } else if (entityRel === relManyToMany) {
                manyToManyRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}} to ${refEntityName}{${schemaNameCamelCase}}${newLine}`);
            } else if (entityRel === relOneToOne) {
                oneToOneRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
            } else if (entityRel === relManyToOne || entityRel == undefined) {
                manyToOneRelations.push(`${schemaNamePascalCase}{${camelCase(propName)}${xRequired ? ' required' : ''}} to ${refEntityName}${newLine}`);
            }
        }
    }

    if (oneToManyRelations.length > 0) {
        relations += `relationship OneToMany {${newLine}${oneToManyRelations.map(r => indent + r).join(newLine)}}${newLine}`;
    }
    if (oneToOneRelations.length > 0) {
        relations += `relationship OneToOne {${newLine}${oneToOneRelations.map(r => indent + r).join(newLine)}}${newLine}`;
    }
    if (manyToManyRelations.length > 0) {
        relations += `relationship ManyToMany {${newLine}${manyToManyRelations.map(r => indent + r).join(newLine)}}${newLine}`;
    }
    if (manyToOneRelations.length > 0) {
        relations += `relationship ManyToOne {${newLine}${manyToOneRelations.map(r => indent + r).join(newLine)}}${newLine}`;
    }
    if (entity.description) {
        entityDescription = `/** ${entity.description} */${newLine}`;
    }
    const packageAnnotation = getAdhocPropertyProperty(xPackageName, entity);
    const annotations = `@EntityPackage(${packageAnnotation ?? 'gen'})${newLine}`;
    return `${entityDescription}${annotations}entity ${pascalCase(schemaName)} {${newLine}${propString.replace(/\r?\n$/, "")}${newLine}}${newLine}${enumerations}${relations}${newLine}`;
}

function getAdhocPropertyProperty(propertyName: string, obj: any): any {
    const adhocProperty = Object.entries(obj).find(val => val[0] === propertyName);
    return adhocProperty ? adhocProperty[1] : undefined;
}

function mapPropertyType(property: BaseObject, propertyName: string, entity: Entity): string {
    var mappedType = pascalCase(property.type!);
    switch (property.type) {
        case typeNumber:
            var numberValidations = '';
            if (property.minimum) {
                numberValidations += `min(${property.minimum}) `;
            }
            if (property.maximum) {
                numberValidations += `max(${property.maximum})`;
            }
            mappedType = `BigDecimal ${numberValidations.trim()}`;
            break;
        case typeInteger:
            var numberValidations = '';
            if (property.minimum) {
                numberValidations += `min(${property.minimum}) `;
            }
            if (property.maximum) {
                numberValidations += `max(${property.maximum})`;
            }
            if (property.format) {
                switch (property.format) {
                    case 'int64':
                        mappedType = `Long ${numberValidations.trim()}`;
                        break;
                }
            } else {
                mappedType = `Integer ${numberValidations.trim()}`;
            }
            break;
        case typeString:
            mappedType = `String`;
            if (property.format) {
                switch (property.format) {
                    case 'date':
                        mappedType = 'LocalDate';
                        break;
                    case 'date-time':
                        mappedType = 'ZonedDateTime';
                        break;
                }
            }

            if (!property.format?.match(/(date)/)) {
                if (property.minLength) {
                    mappedType += ` minlength(${property.minLength})`;
                }
                if (property.maxLength) {
                    mappedType += ` maxlength(${property.maxLength})`;
                }
                if (property.pattern) {
                    mappedType += ` pattern(/${property.pattern}/)`;
                }
            }
            break;
    }

    if (entity.required && entity.required.includes(propertyName)) {
        mappedType += ' required';
    }

    mappedType = mappedType.trim();

    if (getAdhocPropertyProperty('x-unique', property)) {
        mappedType += ' unique';
    }
    return mappedType.trim();
}

function isTypedProperty(property: Property) {
    return property.type !== undefined;
}

function isSkippableProperty(property: Property, propName: string) {
    return propName.match(/[\-]+/) || ['id', 'uuid', 'downstream_id', 'tags'].includes(propName);
}

function isSkippableSchema(schemaNamePascalCase: string) {
    return schemaNamePascalCase.match(/^.*(CreateRequest|UpdateRequest|PatchRequest|Response|Filter|Sort|SortBy|Query)$/) ||
        ['Links', 'Meta'].includes(schemaNamePascalCase);
}

function generateEnum(enumName: string, obj: BaseObject) {
    return `
${obj.description ? '/** ' + obj.description + ' */' : ''}
enum ${enumName} {
${obj.enum!.map(e => indent + snakeCase(e).toUpperCase()).join(newLine)}
}`;
}

class BaseObject {
    type?: string;
    description?: string;
    enum?: Array<string>;
    maximum?: number;
    minimum?: number;
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    format?: string;
}

interface Entity extends BaseObject {
    properties: {[key: string]: Property};
    required?: Array<string>;
    oneOf?: [{ [key: string]: string; }];
    allOf?: [{ [key: string]: string; }];
    anyOf?: [{ [key: string]: string; }];
}

interface Property extends BaseObject {
    items?: { [key: string]: string; };
    $ref?: string;
    allOf?: [{ [key: string]: string; }];
    unique?: boolean;
}

function resolveArgument(argName: string, defaultValue: string, args?: Array<string>) {
    if (!args) {
        return defaultValue;
    }
    
    for (var el in args) {
        var param = args[el].substring(2);
        var parts = param.split('=');
        if (argName === parts[0]) {
            return parts[1];
        }
    }
    return defaultValue;
}

try {
    var args = process.argv.slice(2);
    
    var pathToApiSpec = resolveArgument('api-spec', 'samples/api.yaml', args);
    var packageName = resolveArgument('package-name', 'io.kingstoncloud.app');
    var baseName = resolveArgument('base-name', 'SampleApp');
    var pathToOutputJdl = resolveArgument('jdl-output', 'output/domain.jdl');
    console.info(`${pathToApiSpec} ${packageName} ${baseName} ${pathToOutputJdl}`)
    processOpenApiSpec(pathToApiSpec, packageName, baseName, pathToOutputJdl);
} catch(e) {
    throw new Error(usageText);
}