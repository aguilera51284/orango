const { Builder } = require('tangjs')
const { asyncForEach, jsonStringify } = require('tangjs/lib/helpers')
const { sortToAQL, criteriaBuilder, setDefaultsToNull, arrayOverride, createUniqueId } = require('./helpers')
const lodashGet = require('lodash/get')
const lodashSet = require('lodash/set')
const lodashUnset = require('lodash/unset')
const EXPR = /"expr\([\s+]?([\w\s.+-]+)\)"/gi
const pluralize = require('pluralize')
const { AQL, HOOKS, RETURN, METHODS, TANG } = require('./consts')
require('colors')

async function convertToAQLExpression(val, prop, target, path) {
  delete target._id
  delete target._key
  delete target._rev

  switch (typeof val) {
    case 'object':
      if (!(val instanceof Array)) {
        if (val.$inc != undefined) {
          target[prop] = 'EXPR(' + path.join('.') + '+' + val.$inc + ')'
        } else {
          await asyncForEach(val, convertToAQLExpression, path)
        }
      }
      break
    case 'string':
      if (val.match(/[+-=]{2}\s?\d/gi)) {
        target[prop] = 'EXPR(' + path.join('.') + val[0] + val.substr(2) + ')'
      }
      break
  }
}

function isDoc(returnVal) {
  return returnVal === RETURN.DOC
}

function isOld(returnVal) {
  return returnVal === RETURN.OLD
}

function isNewOld(returnVal) {
  return returnVal === RETURN.NEW_OLD
}

class ORM {
  constructor() {
    this.aqlSegments = []
    this._doc = ''
    this._counter = 0
    this._offset = 0
    this._withDefaults = false
    this._defaults = false
    this._criteria = {}
    this._separator = ''
    this._schemaOptions = {}
    this._options = {}
    this._subdocsOptions = {
      pulls: {},
      ignores: {}
    }
    this._eaches = []
    this._populates = []
    this._vars = []
    this._joins = []
    this._return = null
    this._one = false
    this._toModel = false
  }

  getDocName(name = '') {
    name = name || this._doc || pluralize.singular(this._model.collectionName)
    name = name.split('.').join('_').split('$').join('')
    return '$' + name + ''
  }

  id() {
    this._id = true
    return this
  }

  doc(val = 'doc') {
    this._doc = val
    return this
  }

  parentDoc(val) {
    this._parentDoc = val
    return this
  }

  model(val) {
    this._model = val
    return this
  }

  connection(val) {
    this._connection = val
    return this
  }

  collection(val) {
    this._collection = val
    this._doc = pluralize.singular(this._collection.name)
    return this
  }

  criteria(val = {}) {
    this._criteria = val
    return this
  }

  withDefaults(val = true) {
    this._withDefaults = val
    return this
  }

  defaults(val = true) {
    this._defaults = val
    return this
  }

  query(val) {
    this._query = val
    return this
  }

  schemaOptions(val = {}) {
    this._schemaOptions = val
    return this
  }

  options(val = {}) {
    this._options = val
    return this
  }

  method(val) {
    this._method = val
    return this
  }

  data(val) {
    this._data = val
    return this
  }

  computed(val = true) {
    this._computed = val
    return this
  }

  offset(val) {
    this._offset = val
    return this
  }

  limit(val) {
    this._limit = val
    return this
  }

  sort(val) {
    this._sort = val
    return this
  }

  select(val) {
    this._select = val
    return this
  }

  return(val = RETURN.DOC) {
    this._return = val
    return this
  }

  one(val = true) {
    this._one = val
    return this
  }

  toModel(val = true) {
    if (!this._return) {
      this.return()
    }
    this._toModel = val
    return this
  }

  each(cb) {
    this._eaches.push(cb)
    return this
  }

  var(key, value) {
    this._vars.push({
      key,
      value
    })
    return this
  }

  populate(
    property,
    value,
    options = {
      merge: false
    }
  ) {
    if (value instanceof ORM) {
      value.parentDoc(this.getDocName())
    }

    this._populates.push({
      property,
      value,
      options
    })
    return this
  }

  append(property, path) {
    if (path) {
      this._joins.push(`{${property}:${path}}`)
    } else {
      this._joins.push(`{${property}}`)
    }
    return this
  }

  merge(property, keep) {
    if (keep) {
      keep = keep.split(' ').join("','")
      this._joins.push(`KEEP(${property},'${keep}')`)
    } else {
      this._joins.push(`${property}`)
    }
    return this
  }

  query(data) {
    return Builder.getInstance()
      .data(data)
      .convertTo(Query)
      .toObject({
        computed: true
      })
      .build()
    z
  }

  then(resolve, reject) {
    return this.exec().then(resolve, reject)
  }

  async toAQL(prettify = false) {
    if (prettify) {
      this._separator = '\n   '
    }

    if (this._method === METHODS.INSERT) {
      return this._createInsertQuery()
    }

    if (this._method === METHODS.DOCUMENT) {
      return this._createDocumentQuery()
    }

    if (this._method === METHODS.FIND) {
      return await this._createFindQuery()
    }

    if (this._method === METHODS.FIND_EDGE) {
      return this._createEdgeQuery()
    }

    if (this._method === METHODS.UPDATE) {
      return await this._createUpdateQuery()
    }

    if (this._method === METHODS.DELETE || this._method === METHODS.UNLINK) {
      return this._createDeleteQuery()
    }

    if (this._method === METHODS.COUNT) {
      return this._createCountQuery()
    }
  }

  exec() {
    this._separator = '\n   '

    if (this._method === METHODS.INSERT) {
      return this._insert()
    }

    if (this._method === METHODS.DOCUMENT || this._method === METHODS.FIND) {
      return this._find()
    }

    if (this._method === METHODS.FIND_EDGE) {
      return this._findEdgebound()
    }

    if (this._method === METHODS.UPDATE) {
      return this._update()
    }

    if (this._method === METHODS.DELETE) {
      return this._delete()
    }

    if (this._method === METHODS.LINK) {
      return this._link()
    }

    if (this._method === METHODS.UNLINK) {
      return this._unlink()
    }

    if (this._method === METHODS.COUNT) {
      return this._count()
    }
  }

  _compileAQLSegments() {
    let query = this.aqlSegments.join(' ').replace(EXPR, this.getDocName() + '.$1')
    query = query.replace(
      /'(@@doc)(.\w+)'/g,
      /*this.getDocName()*/
      'doc' + '$2'
    )

    if (query.indexOf('@@parent') !== -1) {
      query = query.replace(/'(.*@@.*)'/g, '$1')
      query = query.split('@@parent').join(this._parentDoc)
    }

    if (
      (this._method === METHODS.DOCUMENT || this._method === METHODS.FIND || this._method === METHODS.FIND_EDGE) &&
      !this._parentDoc
    ) {
      query = query.replace(/([\w\$]+\/)(\$)([\$\w\s|".][\w.]+)/gi, "CONCAT('$1', TO_NUMBER($2$3))")
    }

    return query
  }

  _createAQLInitCount(prop = METHODS.COUNT) {
    this.aqlSegments.push(`LET ${prop} = COUNT(`)
  }

  _createAQLReturnCount(prop = METHODS.COUNT) {
    this._one = true
    this.aqlSegments.push(`RETURN 1) RETURN { ${prop} }`)
  }

  async _createAQLVars() {
    for (let i = 0; i < this._vars.length; i++) {
      let v = this._vars[i]
      if (v.value instanceof ORM) {
        let aql = await v.value.toAQL()
        this.aqlSegments.push(`LET ${v.key} = FIRST(${aql})`)
      } else {
        let val = jsonStringify(v.value)
        this.aqlSegments.push(`LET ${v.key} = ${val}`)
      }
    }
  }

  _createAQLForIn() {
    this.aqlSegments.push('FOR', this.getDocName(), 'IN', this._collection.name)
  }

  _createAQLCustom() {
    let query = this._query.split('@@doc').join(this.getDocName()).split('@@collection').join(this._collection.name)
    this.aqlSegments.push(query)
  }

  _createAQLForInBound() {
    this.aqlSegments.push(
      'FOR',
      this.getDocName(),
      'IN',
      this._criteria.inbound ? 'INBOUND' : 'OUTBOUND',
      `"${this._criteria.id}"`,
      this._criteria.collection
    )
  }

  _createAQLFilter() {
    if (Object.keys(this._criteria).length) {
      this.aqlSegments.push(
        this._separator + 'FILTER',
        criteriaBuilder(this._criteria, this._parentDoc || this.getDocName())
      )
    }
  }

  _createAQLLimit() {
    if (this._offset || this._limit) {
      const offset = this._offset || 0
      const limit = this._limit || 100
      if (offset) {
        this.aqlSegments.push(this._separator + 'LIMIT ' + offset + ',' + limit)
      } else {
        this.aqlSegments.push(this._separator + 'LIMIT ' + limit)
      }
    }
  }

  _createAQLSort() {
    if (this._sort) {
      this.aqlSegments.push(this._separator + 'SORT ' + sortToAQL(this._sort, this.getDocName()))
    }
  }

  _createAQLOptions() {
    let opts = {}
    let hasOptions = false
    if (this._schemaOptions.hasOwnProperty('keepNull')) {
      opts.keepNull = false
      hasOptions = true
    }
    if (hasOptions) {
      this.aqlSegments.push('OPTIONS', JSON.stringify(opts))
    }
  }

  _createAQLReturn(distinct = false) {
    if (isNewOld(this._return)) {
      return this.aqlSegments.push('RETURN { old: OLD, new: NEW }')
    }

    if (this._method === METHODS.UPDATE && isDoc(this._return)) {
      return this.aqlSegments.push('RETURN NEW')
    }

    if (isOld(this._return)) {
      return this.aqlSegments.push('RETURN OLD')
    }

    if (!isDoc(this._return)) {
      return this.aqlSegments.push('RETURN ' + this._return)
    }

    let props = []
    for (let i = 0; i < this._populates.length; i++) {
      if (this._populates[i].options.merge) {
        props.push(this._populates[i].property)
      } else {
        props.push('{' + this._populates[i].property + '}')
      }
    }

    let doc = this._select
      ? 'KEEP(' + this.getDocName() + ', "' + this._select.split(' ').join('","') + '")'
      : this.getDocName()

    if (this._joins.length) {
      props = props.concat(this._joins)
    }

    if (props.length) {
      this.aqlSegments.push('RETURN MERGE(' + doc + ', ' + props.join(', ') + ')')
    } else {
      this.aqlSegments.push('RETURN ' + (distinct ? 'DISTINCT ' : '') + doc)
    }
  }

  /**
   * Parses subdocs and determines if items should be appended, removed or replaced
   * @param {*} arrayPaths
   * @param {*} data
   */
  _parseSubdocs(arrayPaths, data) {
    for (let i = 0; i < arrayPaths.length; i++) {
      const PATH_DOT = arrayPaths[i]
      let isNew = false
      let items = lodashGet(data, PATH_DOT)
      if (items && (items.isOverridden || items.$push || items.$pull)) {
        try {
          if (items.$push) {
            isNew = true
            items = items.$push
          }
        } catch (e) {}

        try {
          let pulls = items.pulls || items.$pull
          if (items.pulls || items.$pull) {
            this._subdocsOptions.pulls[PATH_DOT] = pulls
          }
        } catch (e) {}

        let subdocs = []
        if (items.length) {
          if (jsonStringify(items).indexOf('{') === -1) {
            subdocs = items
          } else {
            for (let i = 0; i < items.length; i++) {
              if (isNew || items[i].isNew) {
                items[i].$id = createUniqueId()
                subdocs.push(items[i])
              }
            }
          }
        }
        if (subdocs.length) {
          lodashSet(data, PATH_DOT, subdocs)
        } else {
          lodashUnset(data, PATH_DOT)
        }
      } else {
        this._subdocsOptions.ignores[PATH_DOT] = true
      }
    }
  }

  async _createAQLSubdocs(arrayPaths, data) {
    for (let i = 0; i < arrayPaths.length; i++) {
      const PATH_DOT = arrayPaths[i]
      const PATH_VAR = PATH_DOT.split('.').join('_')
      if (this._subdocsOptions.ignores[PATH_DOT]) {
        continue
      }
      let pullCriteria = this._subdocsOptions.pulls[PATH_DOT]
      let items = lodashGet(data, PATH_DOT) || []
      try {
        if (items.$push) {
          isNew = true
          items = items.$push
        }
      } catch (e) {}

      let aql = `${this.getDocName()}.${PATH_DOT}`

      // check if there are pulls
      if (pullCriteria) {
        // FOR doc IN users FILTER ((doc.`name` == "rob") OR (doc.`name` == "john")) RETURN doc
        // TODO: This needs to be refactored but just trying to get it working for now
        if (pullCriteria instanceof Array) {
          let ids = JSON.stringify(pullCriteria)
          aql =
            `MINUS(${this.getDocName()}.${PATH_DOT}, ( ` +
            this._separator +
            `FOR item IN ${this.getDocName()}.${PATH_DOT} || [] ` +
            this._separator +
            `FOR id IN ${ids} ` +
            this._separator +
            `FILTER item.$id == id ` +
            this._separator +
            `RETURN item` +
            this._separator +
            `))`
        } else {
          let orm = new ORM()
          orm.method(METHODS.FIND)
          orm.doc('item')
          orm.collection({
            name: `${this.getDocName()}.${PATH_DOT}`
          })
          orm.criteria(pullCriteria)
          orm.return()
          let subquery = await orm.toAQL()

          aql = `MINUS(${this.getDocName()}.${PATH_DOT}, ( ` + this._separator + subquery + this._separator + `))`
        }
      }

      // check if there are pushes
      if (items.length) {
        let subdocsJSON = jsonStringify(items)
        aql = `APPEND(${aql}, ${subdocsJSON})`
      }

      // if there are pulls or pushes
      if (pullCriteria || items.length) {
        aql = `LET ${PATH_VAR} = ${aql}`
        this.aqlSegments.push(aql)
        lodashSet(data, PATH_DOT, '%' + PATH_VAR + '%')
      }
    }
  }

  _createAQLUpdate() {
    const removeOnMatchDefault = this._schemaOptions.removeOnMatchDefault
    const arrayPaths = this._model.schema._arrayPaths
    return new Promise(async (resolve, reject) => {
      const result = await Builder.getInstance()
        .data(this._data)
        .convertTo(this._model)
        .intercept((data) => {
          this._parseSubdocs(arrayPaths, data)
          return data
        })
        .toObject({
          scope: HOOKS.UPDATE,
          noDefaults: !this._defaults,
          unknownProps: this._schemaOptions.strict ? TANG.STRIP : TANG.ALLOW
        })
        .intercept(async (data) => {
          await asyncForEach(data, convertToAQLExpression)
          return data
        })
        .intercept(async (data) => {
          if (removeOnMatchDefault) {
            const defaultValues = this._model.schema.defaultValues
            data = await setDefaultsToNull(data, defaultValues)
          }
          return data
        })
        .intercept(async (data) => {
          await this._createAQLSubdocs(arrayPaths, data)
          return data
        })
        .build()

      if (result instanceof Error) {
        return reject(result)
      }
      let SPECIAL_TAG = JSON.stringify(result).replace(/"%(\w+)%"/g, '$1')
      this.aqlSegments.push(`UPDATE ${this.getDocName()} WITH ${SPECIAL_TAG}`)
      this.aqlSegments.push('IN ' + this._collection.name)
      resolve()
    })
  }

  _createAQLRemove() {
    this.aqlSegments.push('REMOVE ' + this.getDocName())
    this.aqlSegments.push('IN ' + this._collection.name)
  }

  _createInsertQuery() {
    return 'NEW DOCUMENT'
  }

  _createAQLVar() {
    // this._return = this.getDocName()
    this.aqlSegments.push(`LET ${this.getDocName()} =`)
  }

  _createAQLDocument() {
    const key = this._criteria._key
    let documentId = this._model.documentId(key)
    this.aqlSegments.push(`DOCUMENT('${documentId}')`)
  }

  async _createAQLSets() {
    for (let i = 0; i < this._populates.length; i++) {
      let item = this._populates[i]
      if (item.value instanceof ORM) {
        let aql = await item.value.toAQL()
        let first = item.value._return === RETURN.DOC ? 'FIRST' : ''
        this.aqlSegments.push(`LET ${item.property} = ${first}(${aql})`)
      } else {
        this.aqlSegments.push(`LET ${item.property} = ${item.value}`)
      }
    }
  }

  async _createDocumentQuery() {
    this._createAQLVar()
    this._createAQLDocument()
    await this._createAQLSets()
    this._createAQLReturn()
    return this._compileAQLSegments()
  }

  async _createFindQuery() {
    if (this._query) {
      this._createAQLCustom()
    } else {
      await this._createAQLVars()
      this._createAQLForIn()
      this._createAQLFilter()
      await this._createAQLSets()
    }
    this._createAQLSort()
    this._createAQLLimit()
    this._createAQLReturn()

    return this._compileAQLSegments()
  }

  _createCountQuery() {
    this._createAQLInitCount(METHODS.COUNT)
    if (this._query) {
      this._createAQLCustom()
    } else {
      this._createAQLForIn()
      this._createAQLFilter()
    }
    this._createAQLSort()
    this._createAQLLimit()
    this._createAQLReturnCount(METHODS.COUNT)

    return this._compileAQLSegments()
  }

  // TODO: Keeping as a reminder on how to implement this in updated populate() function
  // _createPopulateIntercepts(builder) {
  //   if (this._populates.length) {
  //     for (let i = 0; i < this._populates.length; i++) {
  //       let populate = this._populates[i]
  //       builder.intercept(async doc => {
  //         let item = lodashGet(doc, populate.property)
  //         let dm = populate.documentOrModel
  //         let Model = typeof dm === 'string' ? this._vars[dm].Model : dm
  //         let newItem = await new Model(item).toObject({
  //           noDefaults: populate.options.noDefaults,
  //           computed: populate.options.computed
  //         })
  //         lodashSet(doc, populate.property, newItem)
  //         return doc
  //       })
  //     }
  //   }
  // }

  _applyEaches(builder) {
    for (let i = 0; i < this._eaches.length; i++) {
      builder.intercept(this._eaches[i])
    }
  }

  _insert() {
    this._model.emit(HOOKS.CREATE, {
      model: this._model,
      data: this._data,
      orm: this
    })

    const promise = new Promise(async (resolve, reject) => {
      try {
        let builder = Builder.getInstance().data(this._data).convertTo(this._model).toObject({
          scope: HOOKS.CREATE,
          noDefaults: !this._withDefaults,
          unknownProps: this._schemaOptions.strict ? TANG.STRIP : TANG.ALLOW
        })

        let data = await builder.build()
        if (data) {
          let doc = await this._collection.save(data)

          let builder = Builder.getInstance().data(doc.new || doc).convertTo(this._model).toObject({
            skipValidation: true,
            computed: this._computed,
            noDefaults: !(this._defaults || this._withDefaults)
          })

          this._applyEaches(builder)

          builder.intercept((target) => {
            if (this._id) {
              target.id = target._key
              delete target._key
              delete target._id
              delete target._rev
              delete this._data._key
              delete this._data._id
              delete this._data._rev
            }
            return target
          })
          data = await builder.build()
          Object.assign(this._data, data)
          return resolve(this._data)
        }
        return resolve()
      } catch (e) {
        return reject(e)
      }
    })

    promise.then(
      (data) => {
        if (data) {
          this._model.emit(HOOKS.CREATED, {
            model: this._model,
            data,
            orm: this
          })
        }
      },
      // prevents Unhandled error warnings
      () => {
        // do nothing
      }
    )

    return promise
  }

  _find() {
    // if (!isDoc(this._return)) {
    //   throw new Error(ERRORS.INVALID_RETURN)
    // }

    return new Promise(async (resolve, reject) => {
      try {
        const query =
          this._method === METHODS.DOCUMENT ? await this._createDocumentQuery() : await this._createFindQuery()

        // perform query
        let cursor = await this._connection.db.query(query)
        let docs = await cursor.all()
        if (docs[0] === null) {
          docs.length = 0
        }
        let builder = Builder.getInstance().data(docs)
        builder.convertTo(this._model)

        if (!this._toModel) {
          builder.toObject({
            skipValidation: true,
            computed: this._computed,
            noDefaults: !this._defaults
          })
        }

        // TODO: Keeping as a reminder on how to implement this in updated populate() function
        // this._createPopulateIntercepts(builder)

        this._applyEaches(builder)

        builder.intercept((target) => {
          if (this._id) {
            target.id = target._key
            delete target._key
            delete target._id
            delete target._rev
          }
          return target
        })

        let result = await builder.build()

        const arrPaths = this._model.schema._arrayPaths

        if (result && this._one) {
          for (let i = 0; i < arrPaths.length; i++) {
            let arr = lodashGet(result[0], arrPaths[i])
            arrayOverride(arr)
          }
          // return as object or model
          return resolve(result[0])
        }

        // return as array
        return resolve(result)
      } catch (e) {
        return reject(e.message)
      }
    })
  }

  _link() {}

  _unlink() {
    return this._delete().then(
      (result) => {
        this._model.emit(HOOKS.UNLINKED, {
          model: this._model,
          data: this._options
        })
        return result
      },
      (e) => {
        return e
      }
    )
  }

  _count() {
    return new Promise(async (resolve, reject) => {
      try {
        const query = this._createCountQuery()

        // perform query
        let cursor = await this._connection.db.query(query)
        let result = await cursor.next()
        return resolve(result.count)
      } catch (e) {
        return reject(e.message)
      }
    })
  }

  async _createEdgeQuery() {
    this._createAQLForInBound()
    this._createAQLSort()
    this._createAQLLimit()
    this._createAQLReturn(true)

    return this._compileAQLSegments()
  }

  _findEdgebound() {
    return new Promise(async (resolve, reject) => {
      try {
        const query = await this._createEdgeQuery()

        // perform query
        let cursor = await this._connection.db.query(query)
        let docs = await cursor.all()
        let builder = await Builder.getInstance().data(docs).convertTo(this._model).toObject({
          computed: this._computed,
          noDefaults: !this._defaults,
          unknownProps: this._schemaOptions.strict ? TANG.STRIP : TANG.ALLOW
        })

        this._applyEaches(builder)

        builder.intercept((target) => {
          if (this._id) {
            target.id = target._key
            delete target._key
            delete target._id
            delete target._rev
          }
          return target
        })

        let result = await builder.build()

        if (this._limit === 1 && result) {
          return resolve(result[0])
        }

        return resolve(result)
      } catch (e) {
        return reject(e.message)
      }
    })
  }

  async _createUpdateQuery() {
    if (!this._return) {
      this._createAQLInitCount(AQL.MODIFIED)
    }
    this._createAQLForIn()
    this._createAQLFilter()
    this._createAQLSort()
    this._createAQLLimit()
    await this._createAQLUpdate()
    this._createAQLOptions()

    if (this._return) {
      this._createAQLReturn()
    } else {
      this._createAQLReturnCount(AQL.MODIFIED)
    }
    return this._compileAQLSegments()
  }

  _update() {
    this._model.emit(HOOKS.UPDATE, {
      model: this._model,
      data: this._data,
      orm: this
    })

    const promise = new Promise(async (resolve, reject) => {
      try {
        const query = await this._createUpdateQuery()

        let cursor = await this._connection.db.query(query)
        let results

        if (this._return) {
          results = await cursor.all()

          if (this._return) {
            await asyncForEach(results, async (result, index, list) => {
              if (isNewOld(this._return)) {
                result = [ result.new || {}, result.old || {} ]
              }
              let builder = Builder.getInstance().data(result).convertTo(this._model)
              if (this._toModel === false) {
                builder.toObject({
                  skipValidation: true,
                  computed: this._computed,
                  noDefaults: !this._defaults
                })
              }
              result = await builder.build()

              if (isNewOld(this._return)) {
                result = {
                  new: result[0],
                  old: result[1]
                }
              }
              list[index] = result
            })
            if (this._one) {
              return resolve(results[0])
            }
          }
        } else {
          results = await cursor.next()
        }
        return resolve(results)
      } catch (e) {
        // console.log('ERROR'.bgRed, e.message)
        return reject(e.message)
      }
    })

    promise.then((data) => {
      this._model.emit(HOOKS.UPDATED, {
        model: this._model,
        data,
        orm: this
      })
    })

    return promise
  }

  _createDeleteQuery() {
    if (!this._return) {
      this._createAQLInitCount(AQL.DELETED)
    }

    this._createAQLForIn()
    this._createAQLFilter()
    this._createAQLSort()
    this._createAQLLimit()
    this._createAQLRemove()

    if (this._return) {
      this._createAQLReturn()
    } else {
      this._createAQLReturnCount(AQL.DELETED)
    }

    return this._compileAQLSegments()
  }

  _delete() {
    this._model.emit(HOOKS.DELETE, {
      model: this._model,
      orm: this
    })

    const promise = new Promise(async (resolve, reject) => {
      try {
        const query = this._createDeleteQuery()

        let cursor = await this._connection.db.query(query)
        if (this._return === RETURN.DOC) {
          return resolve(cursor.next())
        }
        let result
        if (this._one) {
          result = await cursor.next()
        } else {
          result = await cursor.all()
        }
        return resolve(result)
      } catch (e) {
        return reject(e.message)
      }
    })

    promise.then((docs) => {
      this._model.emit(HOOKS.DELETED, {
        model: this._model,
        data: docs,
        orm: this
      })
    })

    return promise
  }
}

module.exports = ORM
