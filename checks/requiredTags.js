var requiredTags      = function(input, callback) {
    "use strict";
    var evidence = [];
    if (input.message.configurationItem.configurationItemStatus === "OK" ||
        input.message.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        /*
        * Only evaluate policies applicable to the resource type specified in the event.
        */
        var policies = input.config.checks.requiredTags.configuration.policies.filter(function(policy) {
            return policy.resourceTypes.indexOf(input.message.configurationItem.resourceType) >= 0;
        });

        if (!policies.length) {
            console.log("requiredTags: Clearing tagging policy vulnerability");
            return callback(null, false);
        }
        
        for (var i = 0; i <  policies.length; i++) {
            var res = validateTags(
                    input.message.configurationItem.tags,
                    policies[i]);
            if (res && res.length) {
                evidence.concat(res); 
            }
        }
    }
    if (evidence.length) {
        console.log("requiredTags: Creating tagging policy violation");
        return callback(null, {vulnerable: true, evidence: evidence});
    } else {
        console.log("requiredTags: Clearing tagging policy vulnerability");
        return callback(null, {vulnerable: false, evidence: []});
    }
};

function validateTags(tags, policy) {
    "use strict";
    /*
    * All tags in the policy object must be present in 'tags'
    */
    var evidence = [];
    for (var i in policy.tags) {
        if (tags.hasOwnProperty(policy.tags[i].key)) {
            if (policy.tags[i].hasOwnProperty("values") &&
                !match(tags[policy.tags[i].key], policy.tags[i].values)) {
                // Tag value is wrong or missing
                evidence.push(
                    {
                        key: policy.tags[i].key, 
                        value: tags[policy.tags[i].key],
                        reason: "Value mismatch. Expected: '" + policy.tags[i].values + "'"
                    }
                );
            }
        } else {
            // Tag key is missing
            evidence.push({key: policy.tags[i].key, reason: 'Missing Tag Key.'});
        }
    }
    return [];
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
