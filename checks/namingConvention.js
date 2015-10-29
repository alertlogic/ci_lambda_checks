var config            = require('../config.js'),
    namingConvention = function(_snapshotEvent, inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        var resourceName = getResourceName(rawMessage.configurationItem.tags),
            conventions = config.checks.namingConvention.configuration.conventions;

        if (resourceName == null) {
            console.log("namingConvention: Resource name is empty.");
            return callback(null, false);
        }

        if (!matchesConventions(rawMessage.configurationItem.resourceType, resourceName, conventions)) {
            console.log("namingConvention: Creating naming convention vulnerability");
            return callback(null, true);
        }
    }
    console.log("namingConvention: Clearing naming convention vulnerability");
    return callback(null, false);
};

function matchesConventions(resourceType, resourceName, conventions) {
    "use strict";
    console.log("namingConvention: Evaluating: '" + resourceName + "', '" + resourceType + "' Conventions: '" + JSON.stringify(conventions));
    var resourceConventions = conventions.filter(function(convention) {
        return (convention.resourceTypes.indexOf(resourceType) >= 0);
    });

    if (!resourceConventions.length) {
        return true;
    }

    for (var i = 0; i < resourceConventions.length; i++) {
        if (true === resourceConventions[i].hasOwnProperty("patterns")) {
            if (match(resourceName, resourceConventions[i].patterns)) {
                return true;
            }
        }
    }
    return false;
}

function getResourceName(tags) {
    "use strict";
    // Get the Name tag from the configuration item
    if (tags.hasOwnProperty("Name")) {
        return tags.Name;
    }
    return null;
}


function match(resourceName, patterns) {
    "use strict";
    for (var i = 0; i < patterns.length; i++) {
        if (resourceName.match(patterns[i])) {
            return true;
        }
    }
    return false;
}

module.exports = namingConvention;
