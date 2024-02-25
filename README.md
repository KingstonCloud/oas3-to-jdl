# OAS3 to JDL

The aim of this package is to aide developers in going from API contract to working code in the shortest amount of time possible.

This is done by using OAS3 (OpenAPI Specification 3) files and our custom OAS3 extensions to aide in the generation of Jhipster Domain Language (JDL) files.

Finally, you can use the [OpenAPI Generator](https://github.com/OpenAPITools/openapi-generator) to generate the presentation layer (REST API endpoints) and use the [Jhipster Generator](https://github.com/jhipster/generator-jhipster) to generate all the layers below the presentation layer. You will be responsible for connecting the two layers, but it's easier than coding all that manually.

# Setup Code Generation

## Install Node Dependencies

```bash
npm install
```

## Generating Sources

This project focuses heavily on code generation. The following commands are used to generate the sources.

### OpenAPI

The OpenAPI spec is used to generate the API endpoints and the Jhipster JDL. The OpenAPI spec is located at `api.yml`.
The following command is used to generate the sources from the OpenAPI spec:

```bash
npm run generate
```

### JDL (Jhipster Domain Language)

The JDL is used to generate the domain model and the service layer. The JDL is located at `gen/domain.jdl`.

The following command is used to generate the sources from the JDL:

```bash
cd gen
jhipster jdl domain.jdl --skip-fake-data
```

# Customer OAS3 Extensions

## x-entity-ref

This extension is used to reference persisted entities for OAS3 model fields that represent the ID of some persisted entity. This extension is usually used in conjunction with `x-entity-relationship`.

**Type:** `string`

**Location:** `components -> schemas -> [ModelName] -> properties -> [property_name]`

**Possible values:** See [Using $ref](https://swagger.io/docs/specification/using-ref/)

**Example:**

```yaml
XUser:
  description: "User model"
  type: object
  properties:
    tenant_id:
      pattern: '^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$'
      type: string
      x-entity-ref: "#/components/schemas/Tenant"
      x-entity-relationship: many-to-one
```

## x-entity-relationship

This extension is used to create entity relationships.

**Type:** `string`

**Location:** `components -> schemas -> [ModelName] -> properties -> [property_name]`

**Possible values:** one-to-many | one-to-one | many-to-one | many-to-many

Notes: Usually used in conjunction with `$ref` or `x-entity-ref`. The entity being referenced should not include `x-skip-persistence`

**Example:**

```yaml
XUser:
  description: "User model"
  type: object
  properties:
    tenant_id:
      pattern: '^[0-9a-fA-F]{8}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{4}\b-[0-9a-fA-F]{12}$'
      type: string
      x-entity-ref: "#/components/schemas/Tenant"
      x-entity-relationship: many-to-one
    relatedEntity:
      $ref: "#/components/schemas/XUserProfile"
      x-entity-relationship: one-to-one
```

## x-skip-persistence

This extension is used to skip models that should not be persisted. Generally, these would be DTOs on the presentation layer.

**Type:** `boolean`

**Location:** `components -> schemas -> [ModelName]`

**Example:**

```yaml
ModelName:
  description: "My model"
  type: object
  properties:
    field_name:
      description: ""
      maxLength: 10
      type: string
  x-skip-persistence: true
```

## x-required

Used to indicate whether or not a field is mandatory for persistence.

**Type:** `boolean`

**Location:** `components -> schemas -> [ModelName] -> properties -> [property_name]`

**Example:**

```yaml
XUser:
  description: "User model"
  type: object
  properties:
    tenant_id:
      type: string
      x-required: true
```

## x-parent-field-name

Use to indicate the name of the parent field in a one-to-many relationship

**Example:**

```yaml
XUser:
  description: "User model"
  type: object
  properties:
    products:
      type: array
      items:
        $ref: "#/components/schemas/Product"
      x-entity-relationship: one-to-many
      x-parent-field-name: "productOwner"
```

## x-package-name

Used to indicate the package in-which to put an entity

**Type:** `string`

**Location:** `components -> schemas -> [ModelName]`

**Example:**

```yaml
ModelName:
  description: "My model"
  type: object
  properties:
    field_name:
      description: ""
      maxLength: 10
      type: string
  x-package-name: "com.domain.api"
```
