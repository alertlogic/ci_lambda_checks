var winston     = require('winston'),
    config      = require('../config.js');

var validateResourceType = function(check, resourceType) {
    "use strict";
    if (-1 === check.configuration.resourceTypes.indexOf(resourceType)) {
        return false;
    }
    return true;
};

var isValidMode = function(checkMode, eventType) {
    "use strict";
    if (checkMode === 'all') { return true;}
    return (checkMode.indexOf(eventType) >= 0);
};

var getCheckMode = function(check) {
    "use strict";
    if (check.hasOwnProperty('mode')) {
        return check.mode;
    } else {
        return ['configurationItem',  'snapshotEvent', 'configRule'];
    }
};

var validateCheckName = function(checkName) {
    "use strict";
    return (null != checkName.match("^[a-zA-Z0-9]*$"));
};

var validateRegion = function(check, awsRegion) {
    "use strict";
    if (check.hasOwnProperty('supported')) {
        return contains(awsRegion, check.supported);
    }

    if (config.hasOwnProperty('supported')) {
        return contains(awsRegion, config.supported);
    }
    return false;
};

var getWhitelistHandler = function(check) {
    "use strict";
    if (!check.configuration.hasOwnProperty('whitelist')) {
        return null;
    }

    if (check.configuration.whitelist.hasOwnProperty('whitelistHandler')) {
        return check.configuration.whitelist.whitelistHandler;
    }
    return 'worker';    
};

var isResourceWhitelisted = function(check, resourceType, resourceId, tags) {
    "use strict";
    winston.info("Worker [%s:%s]: isResourceWhitelisted called for check '%s'. ResourceType: '%s', ResourceId: '%s', Tags: '%s'",
                 config.accountId, config.environmentId,
                 check.name.toString(), resourceType, resourceId, JSON.stringify(tags));
    if (!(check.configuration.hasOwnProperty('whitelist') && check.configuration.whitelist.hasOwnProperty('data')) ) {
        // whitelist field is missing in configuration.
        return false;
    }

    if (Object.prototype.toString.call(check.configuration.whitelist.data) !== '[object Array]') {
        winston.error("Worker [%s:%s]: Value of the whitelist field must be an Array. Skipping execution of the check '%s'",
                      config.accountId, config.environmentId, check.name.toString());
        return false;
    }
    
    for (var i = 0; i < check.configuration.whitelist.data.length; i++) {
        var whitelistItem = check.configuration.whitelist.data[i];
        if (!contains(resourceType, whitelistItem.resourceTypes)) {
            // This element doesn't apply to the current resource type.
            continue;
        }

        if (whitelistItem.hasOwnProperty('ids')) {
            if (contains(resourceId, whitelistItem.ids)) {
                winston.info("Worker [%s:%s]: ResourceType: '%s', ResourceId: '%s' is whitelisted for '%s' check.",
                             config.accountId, config.environmentId, resourceType, resourceId, check.name.toString());
                return true;
            } else {
                continue;
            }
        }

        if (whitelistItem.hasOwnProperty('tags')) {
            for (var l = 0; l < whitelistItem.tags.length; l++) {
                var whitelistItemTag = whitelistItem.tags[l];
                if (whitelistItemTag.hasOwnProperty('name') && tags.hasOwnProperty(whitelistItemTag.name)) {
                    if (whitelistItemTag.hasOwnProperty('value')) {
                        if (contains(tags[whitelistItemTag.name], whitelistItemTag.value)) {
                            winston.info("Worker [%s:%s]: ResourceType: '%s', ResourceId: '%s' is whitelisted for '%s' check.",
                                     config.accountId, config.environmentId, resourceType, resourceId, check.name.toString());
                            return true;
                        }
                    } else {
                        winston.info("Worker [%s:%s]: ResourceType: '%s', ResourceId: '%s' is whitelisted for '%s' check.",
                                 config.accountId, config.environmentId, resourceType, resourceId, check.name.toString());
                        return true;
                    }
                }
            }
        }
    }

    // Resource isn't whitelisted
    return false;
};

var getWhitelistEc2Filter = function(check) {
    "use strict";
    var result = [];

    if (!(check.configuration.hasOwnProperty('whitelist') && check.configuration.whitelist.hasOwnProperty('data')) ) {
        return result;
    }

    var whitelist = check.configuration.whitelist.data,
        filter    = null;
    for (var i = 0; i < whitelist.length; i++) {
        if (contains('AWS::EC2::Instance', whitelist[i].resourceTypes)) {
            if (whitelist[i].hasOwnProperty('ids')) {
                filter = getFilter('ids', whitelist[i].ids);
                if (filter) {result.push(filter);}
            }

            if (whitelist[i].hasOwnProperty('tags')) {
                filter = getFilter('tags', whitelist[i].tags);
                if (filter) {result = result.concat(filter);}
            }
        }
    }
    return result;
};

function contains(value, listOrString) {
    "use strict";
    if (Object.prototype.toString.call(listOrString) === '[object Array]') {
        return listOrString.some(function(element, index, array) {
            return (null !== value.match(element));
        });
    }
    return (null !== value.match(listOrString));
}

function getFilter(filterName, values) {
    "use strict";
    if ('ids' === filterName) {
        return {'InstanceIds': toArray(values)};
    } else if ('tags' === filterName &&
               Object.prototype.toString.call(values) === '[object Array]' &&
               values.length) {
        var filters = [];
        for (var i = 0; i < values.length; i++) {
            filters.push({"Filters": [{"Name": "tag:" + values[i].name, "Values": toArray(values[i].value)}]});
        }
        return filters;
    }
    return null; 
}

function toArray(value) {
    "use strict";
    if (Object.prototype.toString.call(value) === '[object Array]') {
        return value;
    }
    return [value];
}

module.exports = {
    "validateResourceType": validateResourceType,
    "isValidMode": isValidMode,
    "getCheckMode": getCheckMode,
    "validateCheckName": validateCheckName,
    "validateRegion": validateRegion,
    "isResourceWhitelisted": isResourceWhitelisted,
    "getWhitelistEc2Filter": getWhitelistEc2Filter,
    "getWhitelistHandler": getWhitelistHandler
};
