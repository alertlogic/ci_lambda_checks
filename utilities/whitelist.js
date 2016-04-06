var api               = require('./api.js'),
    getWhitelistedTags = function(token, accountId, environmentId, callback) {
        "use strict";
        var params = {
            'service': 'whitelist',
            'version': 'v1',
            'accountId': accountId,
            'id': environmentId
        };
        api.getMany(token, params, callback);
    };

module.exports = {
    'getWhitelistedTags': getWhitelistedTags
};
