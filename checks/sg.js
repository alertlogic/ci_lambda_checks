var BitArray       = require('../utilities/bit_array.js'),
    config         = require('../config.js'),
    pkg            = require('../package.json'),
    sg             = function(rawMessage)  {
    "use strict";
    if (rawMessage.hasOwnProperty('configurationItem') &&
        rawMessage.configurationItem.hasOwnProperty('resourceType') &&
        rawMessage.configurationItem.resourceType === "AWS::EC2::SecurityGroup") {
        var metadata = {
            scanner: "custom",
            scanner_scope: "sgPolicy",
            timestamp: Math.round(+new Date()/1000),
            asset_id: "/aws/" + rawMessage.configurationItem.awsRegion + "/sg/" + rawMessage.configurationItem.resourceId,
            environment_id: config.environmentId,
            scan_policy_snapshot_id: "sg_policy_scope_v" + pkg.version,
            content_type: "application/json"
        };
        if ( rawMessage.configurationItem.configurationItemStatus === "OK") {
            var ingressRules = rawMessage.configurationItem.configuration.ipPermissions, sgAclEntries = new BitArray(65535, 0), index;
            for	(index = 0; index < ingressRules.length; index++) {
                sgAclEntries.setRange(ingressRules[index].fromPort, ingressRules[index].toPort, 1);
            }
            var diff = BitArray.getDifference(sgAclEntries, getAllowedPorts()).toNumber();
            if (diff) {
                console.log("Creating security group vulnerability");
                return {"vulnerable": true, "metadata": metadata};
            }
        }
        console.log("Clearing security group vulnerability");
        return {"vulnerable": false, "metadata": metadata};
    }
};

function getAllowedPorts() {
    "use strict";
    var myArray = new BitArray(65535, 0);
    for (var i = 0; i < config.checks.sg.configuration.approved_ports.length; i++) {
        myArray.setRange(config.checks.sg.configuration.approved_ports[i], config.checks.sg.configuration.approved_ports[i], 1);
    }
    return myArray;
}

module.exports = sg;
