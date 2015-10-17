var api        = require('./api.js'),
    getSources = function(token, callback) {
    "use strict";
    var query = {
        "source.type": "environment"
    };
    api.getAll(token, 'sources', 'sources', query, callback);
},
    getCredential = function(token, id, callback) {
    "use strict";
    api.getOne(token, 'sources', 'credentials', id, callback);
};

module.exports = {
    "getSources": getSources,
    "getCredential": getCredential
};
