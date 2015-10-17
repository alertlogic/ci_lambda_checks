var api               = require('./api.js'),
    getRegionsInScope = function(token, environmentId, callback) {
        "use strict";
        var query = {
            "asset_types": "region",
            "scope": "true"
        };
        api.getMany(token, 'assets', 'environments', environmentId, query, callback);
};

module.exports = getRegionsInScope;
