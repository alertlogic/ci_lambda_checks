var api               = require('./api.js'),
    getRegionsInScope = function(token, environmentId, callback) {
        "use strict";
        var params = {
            'service': 'assets',
            'endpoint': 'environments',
            'id': environmentId,
            'query': {
                'asset_types': 'region',
                'scope': 'true'
            }
        };
        api.getMany(token, params, callback);
};

module.exports = getRegionsInScope;
