const Joi = require('joi')
const getObjectKeys = require('./helpers/getObjectKeys')
const JSONstringify = require('./helpers/jsonStringify')
require('colors')

class Schema {
  constructor(json, options = {}) {
    this._json = json
    this._options = options
    this._joi = this._parse(json)
    this._schemaKeys = getObjectKeys(json)
    this.isSchema = true

    this.statics = {}
    this.methods = {}
    this.computed = {}
  }

  get options() {
    return this._options
  }

  get schemaKeys() {
    return this._schemaKeys
  }

  get json() {
    return this._json
  }

  get joi() {
    return this._joi
  }

  validate(data, options) {
    return this._joi.validate(data, options)
  }

  _error(e) {
    console.error('Error', e.message)
  }

  _parse(data) {
    if (data.schema) {
      return data.schema.joi
    }
    let type = this._parseType(data)
    if (type === 'joi') {
      return data.type || data
    }

    let joiType = Joi[type]()
    if (type === 'object') {
      let schema = {}
      for (let prop in data) {
        if (data.hasOwnProperty(prop)) {
          schema[prop] = this._parse(data[prop])
          this._parseAttrs(prop, joiType, data, val => {
            schema[prop] = val
          })
        }
      }

      // if any children have a default property...
      // if (JSONstringify(data).match(/"default":/gi)) {
      //   let defaultObject = this._createDefaultObject(data)
      //   joiType = joiType.default(defaultObject)
      // }
      joiType.append(schema)
    } else if (type === 'array') {
      // let joiSchemArray = {}
      // if (jsonItem.length > 1) {
      //   throw new Error('Array cannot contain more than one schema')
      // } else if (jsonItem.length === 0) {
      //   joiType = Joi.array().items(Joi.any())
      // } else {
      //   let firstChild = jsonItem[0]
      //   console.log('firstChild'.bgGreen, firstChild)
      //   if (firstChild.isJoi) {
      //     debugger
      //   }
      //   let arrItem = this._parse(0, joiSchemArray, jsonItem[0])
      //   joiType = Joi.array().items(arrItem)
      // }

      // for (let prop in data) {
      //   if (data.hasOwnProperty(prop)) {
      //     joiSchema[prop] = this._parse(data[prop])
      //   }
      // }
    }

    return joiType
  }

  _parseType(item) {

    if (item.isSchema) {
      return 'schema'
    }

    if (item.isJoi) {
      return 'joi'
    }

    let type = typeof item
    if (item.type) {
      type = this._parseType(item.type)
    }
    switch (type) {
      case 'object':
        type = item.type
        if (type === String) {
          return 'string'
        }
        if (type === Number) {
          return 'number'
        }
        if (type === Boolean) {
          return 'number'
        }
        if (type === Date) {
          return 'date'
        }
        if (item instanceof Array) {
          return 'array'
        }
        if (item instanceof Object) {
          return 'object'
        }
        break
      case 'function':
        if (item === String) {
          return 'string'
        }
        if (item === Number) {
          return 'number'
        }
        if (item === Boolean) {
          return 'number'
        }
        if (item === Date) {
          return 'date'
        }
        return 'func'
        break
      default:
        return type
    }
  }

  _parseAttrs(prop, joiType, data, callback) {
    let item = data[prop]
    if (typeof item !== 'function') {
      for (let attr in item) {
        // do not parse type
        if (attr !== 'type') {
          let val = item[attr]
          try {
            if (typeof val === 'function') {
              joiType = joiType[attr](val, `default function() for ${prop}`)
            } else {
              console.log('attr'.bgRed, attr, val)
              joiType = joiType[attr](val)
            }
          } catch (e) {
            this._error(e)
          }
        }
      }
    }
    callback(joiType)
  }

  _createDefaultObject(jsonSchemaItem) {
    let defaultObject = {}
    for (let prop in jsonSchemaItem) {
      if (jsonSchemaItem[prop].hasOwnProperty('default')) {
        defaultObject[prop] = jsonSchemaItem[prop].default
      } else {
        let type = this._parseType(jsonSchemaItem[prop])
        if (type === 'object') {
          defaultObject[prop] = this._createDefaultObject(jsonSchemaItem[prop])
        }
      }
    }
    return defaultObject
  }
}

Schema.Types = {
  String,
  Number,
  Boolean,
  Object,
  Array,
  Date,
  RegExp,
  Id: Joi.any(), // TODO: Do something here, not sure what
  Any: Joi.any(),
  Mixed: Joi.any()
}

module.exports = Schema