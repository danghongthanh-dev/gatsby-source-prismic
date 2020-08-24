import { msg, mapObjVals, isEmptyObj, buildSchemaTypeName } from './utils'

import { SourceNodesArgs, GatsbyGraphQLType, NodePluginSchema } from 'gatsby'
import {
  BaseFieldSchema,
  FieldSchema,
  FieldType,
  GraphQLType,
  GraphQLTypeObj,
  GroupFieldSchema,
  ImageFieldSchema,
  Schema,
  Schemas,
  SliceFieldSchema,
  SlicesFieldSchema,
  TypePath,
  SliceIDsField,
} from './types'

/**
 * Enqueues a GraphQL type definition to be created at a later time.
 *
 * @param typeDef GraphQL type definition.
 */
type EnqueueTypeDef = (typeDef: GatsbyGraphQLType) => void

/**
 * Enqueues a TypePath to the store.
 *
 * @param path Path to the field.
 * @param type GraphQL type identifier for the field.
 */
type EnqueueTypePath = (path: string[], type: GraphQLType | string) => void

interface SchemasToTypeDefsContext {
  customTypeApiId: string
  sliceZoneId?: string
  gatsbyContext: SourceNodesArgs
  enqueueTypeDef: EnqueueTypeDef
  enqueueTypePath: EnqueueTypePath
}

const fieldToType = (
  apiId: string,
  typenamePrefix: string | undefined,
  field: FieldSchema,
  path: string[],
  context: SchemasToTypeDefsContext,
): GraphQLTypeObj | GraphQLType | string => {
  const {
    customTypeApiId,
    enqueueTypeDef,
    enqueueTypePath,
    gatsbyContext,
    sliceZoneId,
  } = context
  const { schema: gatsbySchema, reporter } = gatsbyContext

  // Casting to `FieldType | string` since we may come across an unsupported
  // field type. This will happen when Prismic introduces new field types.
  switch (field.type as FieldType | string) {
    case FieldType.UID:
    case FieldType.Color:
    case FieldType.Select:
    case FieldType.Text: {
      const type = GraphQLType.String
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Boolean: {
      const type = GraphQLType.Boolean
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.StructuredText: {
      const type = GraphQLType.StructuredText
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Number: {
      const type = GraphQLType.Float
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Date:
    case FieldType.Timestamp: {
      const type = GraphQLType.Date
      enqueueTypePath([...path, apiId], type)
      return { type, extensions: { dateformat: {} } }
    }

    case FieldType.GeoPoint: {
      const type = GraphQLType.GeoPoint
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Embed: {
      const type = GraphQLType.Embed
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Image: {
      const type = buildSchemaTypeName(GraphQLType.Image, typenamePrefix)
      enqueueTypePath([...path, apiId], type)

      const thumbnails = (field as ImageFieldSchema)?.config?.thumbnails
      if (thumbnails)
        for (const thumbnail of thumbnails)
          enqueueTypePath(
            [...path, apiId, 'thumbnails', thumbnail.name],
            buildSchemaTypeName(GraphQLType.ImageThumbnail, typenamePrefix),
          )

      return type
    }

    case FieldType.Link: {
      const type = GraphQLType.Link
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Group: {
      const groupTypeName = buildSchemaTypeName(
        `${customTypeApiId} ${apiId} GroupType`,
        typenamePrefix,
      )
      enqueueTypeDef(
        gatsbySchema.buildObjectType({
          name: groupTypeName,
          fields: mapObjVals(
            (subfield, subfieldApiId) =>
              fieldToType(
                subfieldApiId,
                typenamePrefix,
                subfield,
                [...path, apiId],
                context,
              ),
            (field as GroupFieldSchema).config.fields,
          ) as { [key: string]: GraphQLType },
          extensions: { infer: false },
        }),
      )

      const type = `[${groupTypeName}]`
      enqueueTypePath([...path, apiId], type)
      return type
    }

    case FieldType.Slices: {
      const slicesTypeName = buildSchemaTypeName(
        `${customTypeApiId} ${apiId} SlicesType`,
        typenamePrefix,
      )
      const sliceChoices = (field as SlicesFieldSchema).config.choices
      const sliceChoiceTypes = Object.entries(sliceChoices).map(
        ([sliceChoiceApiId, sliceChoice]) =>
          fieldToType(
            sliceChoiceApiId,
            typenamePrefix,
            sliceChoice,
            [...path, apiId],
            {
              ...context,
              sliceZoneId: apiId,
            },
          ),
      )

      enqueueTypeDef(
        gatsbySchema.buildUnionType({
          name: slicesTypeName,
          types: sliceChoiceTypes as string[],
        }),
      )

      const type = `[${slicesTypeName}]`
      enqueueTypePath([...path, apiId], type)
      return {
        type,
        resolve: (parent: SliceIDsField, _args: any, context: any, info: any) =>
          context.nodeModel.getNodesByIds({ ids: parent[info.path.key] }),
      }
    }

    case FieldType.Slice: {
      const {
        'non-repeat': primaryFields,
        repeat: itemsFields,
      } = field as SliceFieldSchema

      const sliceFieldTypes: { [key: string]: string } = {
        slice_type: `${GraphQLType.String}!`,
        slice_label: GraphQLType.String,
      }

      if (primaryFields && !isEmptyObj(primaryFields)) {
        const primaryTypeName = buildSchemaTypeName(
          `${customTypeApiId} ${sliceZoneId} ${apiId} PrimaryType`,
          typenamePrefix,
        )

        enqueueTypeDef(
          gatsbySchema.buildObjectType({
            name: primaryTypeName,
            fields: mapObjVals(
              (primaryField, primaryFieldApiId) =>
                fieldToType(
                  primaryFieldApiId,
                  typenamePrefix,
                  primaryField,
                  [...path, apiId, 'primary'],
                  context,
                ),
              primaryFields,
            ) as { [key: string]: GraphQLType },
          }),
        )

        enqueueTypePath([...path, apiId, 'primary'], primaryTypeName)
        sliceFieldTypes.primary = primaryTypeName
      }

      if (itemsFields && !isEmptyObj(itemsFields)) {
        const itemTypeName = buildSchemaTypeName(
          `${customTypeApiId} ${sliceZoneId} ${apiId} ItemType`,
          typenamePrefix,
        )

        enqueueTypeDef(
          gatsbySchema.buildObjectType({
            name: itemTypeName,
            fields: mapObjVals(
              (itemField, itemFieldApiId) =>
                fieldToType(
                  itemFieldApiId,
                  typenamePrefix,
                  itemField,
                  [...path, apiId, 'items'],
                  context,
                ),
              itemsFields,
            ) as { [key: string]: GraphQLType },
          }),
        )

        const type = `[${itemTypeName}]`
        enqueueTypePath([...path, apiId, 'items'], type)
        sliceFieldTypes.items = type
      }

      const type = buildSchemaTypeName(
        `${customTypeApiId} ${sliceZoneId} ${apiId}`,
        typenamePrefix,
      )

      enqueueTypeDef(
        gatsbySchema.buildObjectType({
          name: type,
          fields: sliceFieldTypes,
          interfaces: ['PrismicSliceInterface', 'Node'],
          extensions: { infer: false },
        }),
      )

      enqueueTypePath([...path, apiId], type)
      return type
    }

    // Internal plugin-specific field not defined in the Prismic schema.
    case FieldType.AlternateLanguages: {
      // The types are intentionally different here. We need to handle
      // AlternateLanguages in a unique way in `documentToNodes.js`.
      enqueueTypePath([...path, apiId], FieldType.AlternateLanguages)
      return `[${GraphQLType.Link}!]!`
    }

    default: {
      const fieldPath = [...path, apiId].join('.')
      reporter.warn(
        msg(
          `Unsupported field type "${field.type}" detected for field "${fieldPath}". JSON type will be used.`,
        ),
      )

      const type = GraphQLType.JSON
      enqueueTypePath([...path, apiId], type)
      return type
    }
  }
}

const schemaToTypeDefs = (
  apiId: string,
  schema: Schema,
  typenamePrefix: string | undefined,
  context: SchemasToTypeDefsContext,
) => {
  const { enqueueTypeDef, enqueueTypePath, gatsbyContext } = context
  const { schema: gatsbySchema } = gatsbyContext

  // UID fields are defined at the same level as data fields, but are a level
  // above data in API responses. Pulling it out separately here allows us to
  // process the UID field differently than the data fields.
  const { uid: uidField, ...dataFields } = Object.values(schema).reduce(
    (acc, tab) => {
      for (const fieldApiId in tab) acc[fieldApiId] = tab[fieldApiId]
      return acc
    },
    {},
  )

  // UID fields must be conditionally processed since not all custom types
  // implement a UID field.
  let uidFieldType: string | undefined
  if (uidField)
    uidFieldType = fieldToType(
      'uid',
      typenamePrefix,
      uidField,
      [apiId],
      context,
    ) as string

  // The alternate languages field acts as a list of Link fields. Note:
  // AlternateLanguages is an internal plugin-specific type, not from Prismic.
  const alternateLanguagesFieldType = fieldToType(
    'alternate_languages',
    typenamePrefix,
    { type: FieldType.AlternateLanguages } as BaseFieldSchema,
    [apiId],
    context,
  )

  // Create a type for all data fields.
  const dataTypeName = buildSchemaTypeName(`${apiId} DataType`, typenamePrefix)
  enqueueTypePath([apiId, 'data'], dataTypeName)
  enqueueTypeDef(
    gatsbySchema.buildObjectType({
      name: dataTypeName,
      fields: mapObjVals(
        (dataField, dataFieldApiId) =>
          fieldToType(
            dataFieldApiId,
            typenamePrefix,
            dataField,
            [apiId, 'data'],
            context,
          ),
        dataFields,
      ) as { [key: string]: GraphQLType },
      extensions: { infer: false },
    }),
  )

  // Create the main schema type.
  const schemaTypeName = buildSchemaTypeName(apiId, typenamePrefix)
  const schemaFieldTypes = {
    _previewable: {
      type: 'ID!',
      description:
        "Marks the document as previewable using Prismic's preview system. Include this field if updates to the document should be previewable by content editors before publishing. **Note: the value of this field is not stable and should not be used directly**.",
    },
    data: {
      type: dataTypeName,
      description: "The document's fields and their content.",
    },
    dataRaw: {
      type: 'JSON!',
      description:
        "The document's data object without transformations exactly as it comes from the Prismic API.",
    },
    dataString: {
      type: 'String!',
      description:
        "The document's data object without transformations. The object is stringified via `JSON.stringify` to eliminate the need to declare subfields.",
      deprecationReason: 'Use `dataRaw` instead which returns JSON.',
    },
    first_publication_date: {
      type: 'Date!',
      description: "The document's initial publication date.",
      extensions: { dateformat: {} },
    },
    href: { type: 'String!', description: "The document's Prismic API URL." },
    url: {
      type: 'String',
      description: "The document's URL derived via the link resolver.",
    },
    id: {
      type: 'ID!',
      description:
        'Globally unique identifier. Note that this differs from the `prismicID` field.',
    },
    lang: { type: 'String!', description: "The document's language." },
    last_publication_date: {
      type: 'Date!',
      description: "The document's most recent publication date",
      extensions: { dateformat: {} },
    },
    tags: { type: '[String!]!', description: "The document's list of tags." },
    alternate_languages: {
      type: alternateLanguagesFieldType as string,
      description: 'Alternate languages for the document.',
    },
    type: {
      type: 'String!',
      description: "The document's Prismic API ID type.",
    },
    prismicId: { type: 'ID!', description: "The document's Prismic ID." },
  }
  // @ts-expect-error - uid field is not present in the object's type
  if (uidFieldType) schemaFieldTypes.uid = uidFieldType

  enqueueTypePath([apiId], schemaTypeName)
  enqueueTypeDef(
    gatsbySchema.buildObjectType({
      name: schemaTypeName,
      fields: schemaFieldTypes,
      interfaces: ['PrismicDocument', 'Node'],
      extensions: { infer: false },
    }),
  )
}

/**
 * Returns an GraphQL type containing all image thumbnail field names. If no thumbnails are configured, a placeholder type is returned.
 *
 * @param typePaths Array of TypePaths for all schemas.
 * @param gatsbySchema Gatsby node schema.
 *
 * @returns GraphQL type to support image thumbnail fields.
 */
const buildImageThumbnailsType = (
  typePaths: TypePath[],
  typenamePrefix: string | undefined,
  gatsbySchema: NodePluginSchema,
) => {
  const keys = typePaths
    .filter((typePath) => typePath.type === GraphQLType.ImageThumbnail)
    .map((typePath) => typePath.path[typePath.path.length - 1])

  if (keys.length < 1)
    return gatsbySchema.buildScalarType({
      name: buildSchemaTypeName(GraphQLType.ImageThumbnails, typenamePrefix),
      serialize: () => null,
    })

  const fieldTypes = keys.reduce((acc, key) => {
    acc[key] = GraphQLType.ImageThumbnail
    return acc
  }, {} as { [key: string]: GraphQLType.ImageThumbnail })

  return gatsbySchema.buildObjectType({
    name: GraphQLType.ImageThumbnails,
    fields: fieldTypes,
  })
}

/**
 * Converts an object mapping custom type API IDs to JSON schemas to an array
 * of GraphQL type definitions. The result is intended to be called with
 * Gatsby's `createTypes` action.
 *
 * @param schemas An object mapping custom type API IDs to JSON schemas.
 *
 * @returns An array of GraphQL type definitions.
 */
export const schemasToTypeDefs = (
  schemas: Schemas,
  typenamePrefix: string | undefined,
  gatsbyContext: SourceNodesArgs,
) => {
  const { schema: gatsbySchema } = gatsbyContext

  const typeDefs: GatsbyGraphQLType[] = []
  const enqueueTypeDef: EnqueueTypeDef = (typeDef) =>
    void typeDefs.push(typeDef)

  const typePaths: TypePath[] = []
  const enqueueTypePath: EnqueueTypePath = (path, type) =>
    void typePaths.push({ path, type })

  const context = { gatsbyContext, enqueueTypeDef, enqueueTypePath }

  for (const apiId in schemas)
    schemaToTypeDefs(apiId, schemas[apiId], typenamePrefix, {
      ...context,
      customTypeApiId: apiId,
    })

  // Union type for all schemas.
  enqueueTypeDef(
    gatsbySchema.buildUnionType({
      name: GraphQLType.AllDocumentTypes,
      types: Object.keys(schemas).map((apiId) =>
        buildSchemaTypeName(apiId, typenamePrefix),
      ),
    }),
  )

  // Type for all image thumbnail fields.
  enqueueTypeDef(
    buildImageThumbnailsType(typePaths, typenamePrefix, gatsbySchema),
  )

  return { typeDefs, typePaths }
}
