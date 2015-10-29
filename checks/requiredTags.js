var config            = require('../config.js'),
    requiredTags      = function(_snapshotEvent, inScope, awsRegion, vpcId, rawMessage, callback) {
    "use strict";
    if (rawMessage.configurationItem.configurationItemStatus === "OK" ||
        rawMessage.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        /*
        * Only evaluate policies applicable to the resource type specified in the event.
        */
        var policies = config.checks.requiredTags.configuration.policies.filter(function(policy) {
            return policy.resourceTypes.indexOf(rawMessage.configurationItem.resourceType) >= 0;
        });

        if (!policies.length) {
            console.log("requiredTags: Clearing tagging policy vulnerability");
            return callback(null, false);
        }

        for (var i = 0; i <  policies.length; i++) {
            if (!validateTags(
                    rawMessage.configurationItem.resourceType,
                    rawMessage.configurationItem.tags,
                    policies[i])) {
                console.log("requiredTags: Creating tagging policy violation");
                return callback(null, true);
            }
        }
    }
    console.log("requiredTags: Clearing tagging policy vulnerability");
    return callback(null, false);
};

function validateTags(resourceType, tags, policy) {
    "use strict";
    /*
    * All tags in the policy object must be present in 'tags'
    */
    for (var i in policy.tags) {
        if (tags.hasOwnProperty(policy.tags[i].key)) {
            if (policy.tags[i].hasOwnProperty("values") && !match(tags[policy.tags[i].key], policy.tags[i].values)) {
                return false;
            }
        } else {
            return false;
        }
    }
    return true;
}

function match(value, patterns) {
    "use strict";
    for (var i in patterns) {
        if (value.match(patterns[i])) {
            return true;
        }
    }
    return false;
}

module.exports = requiredTags;
