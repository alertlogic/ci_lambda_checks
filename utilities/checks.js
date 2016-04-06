var config      = require('../config.js');

var validateResourceType = function(check, resourceType) {
    "use strict";

    if (check.hasOwnProperty('configuration') &&
            check.configuration.hasOwnProperty('resourceTypes') &&
            -1 === check.configuration.resourceTypes.indexOf(resourceType)) {
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
        return check.mode.toString();
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
function contains(value, listOrString) {
    "use strict";
    if (Object.prototype.toString.call(listOrString) === '[object Array]') {
        return listOrString.some(function(element, index, array) {
            return (null !== value.match(element));
        });
    }
    return (null !== value.match(listOrString));
}

module.exports = {
    "validateResourceType": validateResourceType,
    "isValidMode": isValidMode,
    "getCheckMode": getCheckMode,
    "validateCheckName": validateCheckName,
    "validateRegion": validateRegion
};
