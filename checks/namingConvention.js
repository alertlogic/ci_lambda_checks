var config            = require('../config.js'),
    namingConvention = function(_eventType, inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    var result = {vulnerable: false, evidence: []};
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        var resourceName = getResourceName(rawMessage.configurationItem.tags),
            conventions = config.checks.namingConvention.configuration.conventions;

        if (resourceName == null) {
            console.log("namingConvention: Resource name is empty.");
            return callback(null, result);
        }

        result.evidence = matchesConventions(rawMessage.configurationItem.resourceType, resourceName, conventions);
        if (result.evidence && result.evidence.length) {
            result.vulnerable = true;
            console.log("namingConvention: Creating naming convention vulnerability. Result: %s",
                        JSON.stringify(result));
            return callback(null, result);
        }
    }
    console.log("namingConvention: Clearing naming convention vulnerability");
    return callback(null, result);
};

function matchesConventions(resourceType, resourceName, conventions) {
    "use strict";
    console.log("namingConvention: Evaluating: '" + resourceName + "', '" + resourceType +
                "' Conventions: '" + JSON.stringify(conventions));
    var resourceConventions = conventions.filter(function(convention) {
            return (convention.resourceTypes.indexOf(resourceType) >= 0);
        });

    if (!resourceConventions.length) {
        return [];
    }

    for (var i = 0; i < resourceConventions.length; i++) {
        if (true === resourceConventions[i].hasOwnProperty("patterns")) {
            if (match(resourceName, resourceConventions[i].patterns)) {
                return [];
            }
        }
    }
    return [
        {
            name:   resourceName,
            type:   resourceType,
            reason: "Name doesn't match specified conventions. Conventions: '" +
                    JSON.stringify(resourceConventions) + "'"
        }
    ];
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
