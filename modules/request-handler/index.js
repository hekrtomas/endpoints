const COLLECTION_MODE = 'collection';
const SINGLE_MODE = 'single';
const RELATION_MODE = 'relation';
const RELATED_MODE = 'related';

const _ = require('lodash');
const Kapow = require('kapow');

const throwIfModel = require('./lib/throw_if_model');
const throwIfNoModel = require('./lib/throw_if_no_model');
const verifyAccept = require('./lib/verify_accept');
const verifyContentType = require('./lib/verify_content_type');
const verifyDataObject = require('./lib/verify_data_object');
const splitStringProps = require('./lib/split_string_props');

/**
  Creates a new instance of RequestHandler.

  @constructor
  @param {Endpoints.Adapter} adapter
*/
function RequestHandler (config, adapter) {
  this.config = config;
  this.adapter = adapter;
  this.schema = config.schema || {};
  this.validators = config.validators;
  this.method = config.method;

  // this used to happen in the configureController step
  // TODO: is this even needed? i believe we're only using
  // it to generate the location header response for creation
  // which is brittle and invalid anyway.
  config.typeName = adapter.typeName();
}

/**
  A function that, given a request, validates the request.

  @returns {Object} An object containing errors, if any.
*/
RequestHandler.prototype.validate = function (request) {

  var err;
  var validators = [verifyAccept];

  if (request.body && request.body.data) {
    validators = validators.concat([verifyContentType, verifyDataObject]);
  }

  // does this.validators needs a better name? controllerValidator, userValidators?
  validators = validators.concat(this.validators);

  for (var validate in validators) {
    err = validators[validate](request, this);
    if (err) {
      break;
    }
  }
  return err;
};

/**
  Builds a query object to be passed to Endpoints.Adapter#read.

  @returns {Object} The query object on a request.
 */
RequestHandler.prototype.query = function (request) {
  // bits down the chain can mutate this config
  // on a per-request basis, so we need to clone
  var config = _.cloneDeep(this.config);

  var query = request.query;
  var include = query.include;
  var filter = query.filter;
  var fields = query.fields;
  var sort = query.sort;
  return {
    include: include ? include.split(',') : config.include,
    filter: filter ? splitStringProps(filter) : config.filter,
    fields: fields ? splitStringProps(fields) : config.fields,
    sort: sort ? sort.split(',') : config.sort
  };
};

/**
  Determines mode based on what request.params are available.

  @returns {String} the read mode
*/
RequestHandler.prototype.mode = function (request) {
  var hasIdParam = !!request.params.id;
  var hasRelationParam = !!request.params.relation;
  var hasRelatedParam = !!request.params.related;

  if (!hasIdParam) {
    return COLLECTION_MODE;
  }

  if (!hasRelationParam && !hasRelatedParam) {
    return SINGLE_MODE;
  }

  if (hasRelationParam) {
    return RELATION_MODE;
  }

  if (hasRelatedParam) {
    return RELATED_MODE;
  }

  return Kapow(400, 'Unable to determine mode based on `request.params` keys.');
};

/**
  Creates a new instance of a model.

  @returns {Promise(Bookshelf.Model)} Newly created instance of the Model.
*/
RequestHandler.prototype.create = function (request) {
  var adapter = this.adapter;
  var method = this.method;
  var data = request.body.data;

  if (data && data.id) {
    return adapter.byId(data.id)
      .then(throwIfModel)
      .then(function() {
        return adapter.create(method, data);
      }
    );
  } else {
    return adapter.create(method, data);
  }
};

/**
  Queries the adapter for matching models.

  @returns {Promise(Bookshelf.Model)|Promise(Bookshelf.Collection)}
*/
RequestHandler.prototype.read = function (request) {
  var adapter = this.adapter;
  var query = this.query(request);
  var mode = this.mode(request);

  var params = request.params;
  var id = params.id;

  var related, findRelated;
  if (mode === RELATED_MODE) {
    related = params.related;
    findRelated = adapter.related.bind(adapter, query, related);
    return adapter.byId(id, related).then(throwIfNoModel).then(findRelated);
  }

  // var relation, findRelation;
  if (mode === RELATION_MODE) {
    throw new Error('not implemented');
  }

  if (id) {
    // FIXME: this could collide with filter[id]=#
    query.filter.id = id;
  }
  return adapter.read(query, mode);
};

/**
  Edits a model.

  @returns {Promise(Bookshelf.Model)}
*/
RequestHandler.prototype.update = function (request) {
  var adapter = this.adapter;
  var method = this.method;
  var id = request.params.id;
  var relation = request.params.relation;
  var data = request.body.data;

  if (relation) {
    data = {
      type: adapter.typeName(),
      links: {}
    };
    data.links[relation] = request.body.data;
  }

  return adapter.byId(id).
    then(throwIfNoModel).
    then(function (model) {
      return adapter.update(model, method, data);
    }).catch(function(e) {
      // This may only work for SQLITE3, but tries to be general
      if (e.message.toLowerCase().indexOf('null') !== -1) {
        Kapow.wrap(e, 409);
      }
      throw e;
    });
};

/**
  Deletes a model.

  @returns {Promise(Bookshelf.Model)}
*/
RequestHandler.prototype.destroy = function (request) {
  var method = this.method;
  var adapter = this.adapter;
  var id = request.params.id;

  return adapter.byId(id).then(function (model) {
    if (model) {
      return adapter.destroy(model, method);
    }
  });
};

module.exports = RequestHandler;
