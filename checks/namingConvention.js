var config            = require('../config.js'),
    getAssetKey       = require('../utilities/assets.js'),
    pkg               = require('../package.json'),
    namingConvention = function(rawMessage) {
    "use strict";

    if (rawMessage.hasOwnProperty('configurationItem') &&
        rawMessage.configurationItem.hasOwnProperty('resourceType')) {
        var metadata = {
            scanner: "custom",
            scanner_scope: "naming_convention_policy_scope",
            timestamp: Math.round(+new Date()/1000),
            asset_id: getAssetKey(rawMessage.configurationItem.awsRegion, rawMessage.configurationItem.resourceType, rawMessage.configurationItem.resourceId),
            environment_id: config.environmentId,
            scan_policy_snapshot_id: "naming_convention_policy_scope_v" + pkg.version,
            content_type: "application/json"
        };

        if (rawMessage.configurationItem.configurationItemStatus === "OK") {
            var resourceName = getResourceName(rawMessage.configurationItem.tags),
                conventions = config.checks.naming_convention.configuration.conventions;
            if (!matchesConventions(rawMessage.configurationItem.resourceType, resourceName, conventions)) {
                console.log("Creating naming convention vulnerability");
                return {"vulnerable": true, "metadata": metadata};
            }
        }
        console.log("Clearing naming convention vulnerability");
        return {"vulnerable": false, "metadata": metadata};
    }
};

function matchesConventions(resourceType, resourceName, conventions) {
    "use strict";
    var resourceConventions = conventions.filter(function(convention) {
        return (convention.asset_types.indexOf(resourceType) >= 0);
    });

    if (!resourceConventions.length) {
        return true;
    }

    if (resourceName == null) {
        return false;
    }

    for (var convention in resourceConventions) {
        if (resourceName.match(convention)) {
            return true;
        }
    }
    return false;
}

function getResourceName(Tags) {
    "use strict";
    // Get the Name tag from the configuration item
    for (var tag in Tags) {
        if (tag.key === "Name") {
            return tag.value;
        }
    }
    return null;
}

module.exports = namingConvention;
