var api        = require('./api.js'),
    getSources = function(token, callback) {
    "use strict";
    var params = {
        'service': 'sources',
        'endpoint': 'sources',
        'query': {
            'source.type': 'environment',
            'source.config.collection_method': 'api',
            'source.config.collection_type': 'aws'
        }
    };
    api.getAll(token, params, callback);
},
    getCredential = function(token, id, callback) {
    "use strict";
    var params = {
        'service': 'sources',
        'endpoint': 'credentials',
        'id': id
    };
    api.getOne(token, params, callback);
};

module.exports = {
    "getSources": getSources,
    "getCredential": getCredential
};
