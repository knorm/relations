const { Knorm } = require('@knorm/knorm');
const { camelCase } = require('lodash');

const isArray = Array.isArray;

const addReference = (references, field, reference) => {
  const toModel = reference.model;
  references[toModel.name] = references[toModel.name] || {};
  references[toModel.name][field.name] = field;
};

const mapReferencesByReferencedField = (references, fromModel) => {
  return Object.values(references).reduce((referencesByTo, from) => {
    const references = isArray(from.references)
      ? from.references
      : [from.references];

    references.forEach(reference => {
      if (reference.model.name === fromModel.name) {
        const to = reference.name;
        referencesByTo[to] = referencesByTo[to] || [];
        referencesByTo[to].push(from);
      }
    });
    return referencesByTo;
  }, {});
};

class KnormRelations {
  constructor({ name = 'relations' } = {}) {
    this.name = name;
  }

  updateField(knorm) {
    const { Field } = knorm;

    class RelationsField extends Field {
      constructor(config = {}) {
        super(config);
        if (config.references) {
          this.references = config.references;
        }
      }
    }

    knorm.Field = knorm.Model.Field = RelationsField;
  }

  updateModel(knorm) {
    const { Model } = knorm;

    class RelationsModel extends Model {
      static createConfig() {
        const config = super.createConfig();
        config.references = {};
        config.referenceFunctions = {};
        return config;
      }

      static addField(field) {
        super.addField(field);

        if (field.references) {
          const references = field.references;

          if (typeof references === 'function') {
            this._config.referenceFunctions[field.name] = references;
          } else {
            (isArray(references) ? references : [references]).forEach(
              reference => {
                addReference(this._config.references, field, reference);
              }
            );
          }
        }
      }

      static removeField(field) {
        super.removeField(field);

        const { name, references } = field;

        if (references) {
          if (typeof references === 'function') {
            delete this._config.referenceFunctions[name];
          } else {
            const model = references.model.name;
            delete this._config.references[model][name];
            if (!Object.keys(this._config.references[model]).length) {
              delete this._config.references[model];
            }
          }
        }
      }
    }

    knorm.Model = RelationsModel;
  }

  updateQuery(knorm) {
    const { Query, Model, Field } = knorm;

    const addReferenceByFunction = (
      references,
      func,
      { name, column, type, model }
    ) => {
      let resolvedReferences = func();
      resolvedReferences = isArray(resolvedReferences)
        ? resolvedReferences
        : [resolvedReferences];

      resolvedReferences.forEach(reference => {
        // create a new field to avoid overwriting field.references
        const field = new Field({
          name,
          column,
          type,
          model,
          references: reference
        });
        addReference(references, field, reference);
      });
    };

    class RelationsQuery extends Query {
      constructor(model) {
        super(model);
        // TODO: only initialize parsedRows when needed
        this.parsedRows = new Map();
        // TODO: move these to base model default options
        this.options.ensureUniqueField = true;
        this.config.references = model.config.references;
        this.config.referenceFunctions = model.config.referenceFunctions;
      }

      addJoin(joinType, joins, options) {
        if (!isArray(joins)) {
          joins = [joins];
        }

        // TODO: use appendOption
        this.options.joins = this.options.joins || [];

        joins.forEach(join => {
          if (join.prototype instanceof Model) {
            join = join.query;
          }

          join.setOptions(Object.assign({}, options, { joinType }));

          this.options.joins.push(join);
        });

        return this;
      }

      joinType(joinType) {
        return this.setOption('joinType', joinType);
      }

      leftJoin(queries, options) {
        return this.addJoin('leftJoin', queries, options);
      }

      innerJoin(queries, options) {
        return this.addJoin('innerJoin', queries, options);
      }

      join(queries, options) {
        return this.addJoin('join', queries, options);
      }

      // TODO: require setting `as` when configuring references
      as(as) {
        return this.setOption('as', as);
      }

      // TODO: v2: support multiple fields for `on` via Query.prototpye.appendOption
      // TODO: support raw sql
      on(field) {
        return this.addOption('on', field);
      }

      via(query, options) {
        if (query.prototype instanceof Model) {
          query = query.query;
        }

        query.setOptions(Object.assign({ joinType: 'leftJoin' }, options));

        return this.setOption('via', query);
      }

      getQueryReferences(query) {
        const references = Object.assign({}, query.config.references);

        Object.entries(query.config.referenceFunctions).forEach(
          ([fieldName, referenceFunction]) => {
            const field = query.config.fields[fieldName];
            addReferenceByFunction(references, referenceFunction, field);
          }
        );

        return references;
      }

      getFieldReferences(
        fromQuery,
        toQuery,
        on = [],
        allReferences,
        allReferencesByReferencedField
      ) {
        let fieldReferences;
        const onFields = [];

        on.forEach(field => {
          if (typeof field === 'object' && !(field instanceof Field)) {
            if (field[fromQuery.model.name]) {
              onFields.push(field[fromQuery.model.name]);
            } else if (field[toQuery.model.name]) {
              onFields.push(field[toQuery.model.name]);
            }
          } else {
            onFields.push(field);
          }
        });

        if (onFields.length) {
          fieldReferences = [];
          onFields.forEach(field => {
            if (field instanceof Field) {
              if (field.model === fromQuery.model) {
                if (allReferences[field.name]) {
                  fieldReferences.push(allReferences[field.name]);
                } else {
                  fieldReferences.push(
                    ...allReferencesByReferencedField[field.name]
                  );
                }
                return;
              }
              // TODO: strict mode: throw an error if the field is from a model
              // that is not used in the join
              field = field.name;
            }

            if (allReferencesByReferencedField[field]) {
              fieldReferences.push(...allReferencesByReferencedField[field]);
            } else {
              fieldReferences.push(allReferences[field]);
            }
          });
        } else {
          fieldReferences = Object.values(allReferences);
        }

        return fieldReferences;
      }

      formatOn(fromQuery, toQuery, on) {
        const fromReferences = this.getQueryReferences(fromQuery);
        const toReferences = this.getQueryReferences(toQuery);

        if (
          !fromReferences[toQuery.model.name] &&
          !toReferences[fromQuery.model.name]
        ) {
          throw new Query.QueryError(
            `${fromQuery.model.name}: there are no references to \`${
              toQuery.model.name
            }\``
          );
        }

        const reversed = !!fromReferences[toQuery.model.name];
        const toModel = reversed ? toQuery.model : fromQuery.model;
        const allReferences = Object.assign(
          {},
          fromReferences[toQuery.model.name],
          toReferences[fromQuery.model.name]
        );
        const allReferencesByReferencedField = mapReferencesByReferencedField(
          allReferences,
          toModel
        );
        const fieldReferences = this.getFieldReferences(
          fromQuery,
          toQuery,
          on,
          allReferences,
          allReferencesByReferencedField
        );

        return fieldReferences.reduce((columns, field) => {
          const fromColumn = field.column;
          const referencedFields = isArray(field.references)
            ? field.references
            : [field.references];

          referencedFields.forEach(reference => {
            if (reference.model.name === toModel.name) {
              const toColumn = reference.column;
              let formattedFromColumn;
              let formattedToColumn;

              if (reversed) {
                formattedFromColumn = toQuery.formatColumn(toColumn);
                formattedToColumn = fromQuery.formatColumn(fromColumn);
              } else {
                formattedFromColumn = toQuery.formatColumn(fromColumn);
                formattedToColumn = fromQuery.formatColumn(toColumn);
              }

              columns[formattedFromColumn] = formattedToColumn;
            }
          });

          return columns;
        }, {});
      }

      // TODO: v2: do not rely on `getTable` auto-aliasing (@knorm/knorm v2)
      async prepareOn(sql, fromQuery, toQuery, joinType, on) {
        const table = toQuery.getTable();

        if (typeof joinType === 'object') {
          if (joinType[fromQuery.model.name]) {
            joinType = joinType[fromQuery.model.name];
          } else if (joinType[toQuery.model.name]) {
            joinType = joinType[toQuery.model.name];
          } else {
            joinType = 'leftJoin';
          }
        }

        sql[joinType](table, this.formatOn(fromQuery, toQuery, on));

        return sql;
      }

      async prepareJoin(sql, options) {
        const from = this.parent;
        const to = this;
        const via = this.getOption('via');

        if (via) {
          const joinType = via.getOption('joinType');

          let firstOn;
          let secondOn;
          firstOn = secondOn = via.getOption('on');

          if (from.model === to.model && !firstOn) {
            const references = this.getQueryReferences(via);
            if (references[from.model.name]) {
              const referenceFields = Object.values(
                references[from.model.name]
              );
              firstOn = [referenceFields[0]];
              secondOn = [referenceFields[1]];
            }
          }

          sql = await this.prepareOn(sql, from, via, joinType, firstOn);
          sql = await this.prepareOn(sql, via, to, joinType, secondOn);
        } else {
          const joinType = to.getOption('joinType');
          const on = to.getOption('on');
          sql = await this.prepareOn(sql, from, to, joinType, on);
        }

        // select all fields if none have been selected for the join
        this.ensureFields();

        return this.prepareSql(sql, options);
      }

      ensureUniqueField(toQuery) {
        const aliases = Object.keys(this.options.fields);
        const fields = Object.values(this.options.fields);
        let unique;

        [this.config.primary].concat(this.config.unique).some(field => {
          const index = fields.indexOf(field);
          if (index > -1) {
            unique = aliases[index];
            return true;
          }
          return false;
        });

        if (!unique) {
          throw new Query.QueryError(
            `${this.model.name}: cannot join \`${
              toQuery.model.name
            }\` with no primary or unique fields selected`
          );
        }

        this.options.unique = unique;
      }

      async prepareJoins(query, options) {
        return Promise.all(
          this.options.joins.map(async join => {
            // depended on by @knorm/paginate
            if (this.options.ensureUniqueField) {
              this.ensureUniqueField(join);
            }

            join.parent = this;
            // depended on by @knorm/postgres
            join.config.joined = true;
            join.config.index = ++this.config.index;
            // TODO: support custom aliases
            join.config.alias = `${join.config.alias}_${join.config.index}`;

            // TODO: remove
            if (!join.options.as) {
              join.options.as = camelCase(join.model.name);
            }

            return join.prepareJoin(query, options);
          })
        );
      }

      async prepareSql(sql, options) {
        sql = await super.prepareSql(sql, options);

        if (this.options.joins) {
          await this.prepareJoins(sql, options);
        }

        return sql;
      }

      throwFetchRequireError() {
        super.throwFetchRequireError();

        if (this.options.joins) {
          this.options.joins.forEach(query => query.throwFetchRequireError());
        }
      }

      // TODO: strict mode: throw if the value for the unique field is null or undefined
      getParsedRow(row) {
        let parsedRow = super.getParsedRow(row);

        if (!this.options.joins) {
          return parsedRow;
        }

        const unique =
          row[this.formatFieldAlias(this.options.unique, { quote: false })];

        if (unique) {
          const uniqueRow = this.parsedRows.get(unique);
          if (uniqueRow) {
            parsedRow = uniqueRow;
          } else {
            this.parsedRows.set(unique, parsedRow);
          }
        }

        return parsedRow;
      }

      parseRow(row) {
        const parsedRow = super.parseRow(row);

        if (this.options.joins) {
          this.options.joins.forEach(join => {
            const as = join.options.as;
            const first = join.options.first;

            const data = join.parseRow(row);
            // the performance of this check could be improved by checking row
            // values while parsing the row but at a cost to code complexity
            const isEmpty = Object.values(data).every(value => value === null);

            // TODO: strict mode: warn if joined data replaces already existing
            // fields on the row
            if (isEmpty) {
              parsedRow[as] = null;
            } else if (first) {
              if (!parsedRow[as] || !parsedRow[as].knorm) {
                // TODO: avoid adding extra properties to data fetched from the
                // database
                if (!(data instanceof Model)) {
                  Object.defineProperty(data, 'knorm', { value: true });
                }
                parsedRow[as] = data;
              }
            } else {
              if (!isArray(parsedRow[as])) {
                parsedRow[as] = [];
              }
              parsedRow[as].push(data);
            }
          });
        }

        return parsedRow;
      }

      parseRows(rows) {
        const parsedRows = super.parseRows(rows);

        if (this.options.joins) {
          return Array.from(this.parsedRows.values());
        }

        return parsedRows;
      }
    }

    knorm.Query = knorm.Model.Query = RelationsQuery;
  }

  init(knorm) {
    if (!knorm) {
      throw new this.constructor.KnormRelationsError(
        'no Knorm instance provided'
      );
    }

    if (!(knorm instanceof Knorm)) {
      throw new this.constructor.KnormRelationsError(
        'invalid Knorm instance provided'
      );
    }

    this.updateModel(knorm);
    this.updateField(knorm);
    this.updateQuery(knorm);
  }
}

KnormRelations.KnormRelationsError = class KnormRelationsError extends Knorm.KnormError {};

module.exports = KnormRelations;
