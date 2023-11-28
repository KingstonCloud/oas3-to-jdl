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