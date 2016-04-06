var BitArray       = require('../utilities/bit_array.js'),
    config         = require('../config.js'),
    sg             = function(input, callback)  {
    "use strict";
    var result = {vulnerable: false, evidence: []};
    if (input.message.configurationItem.configurationItemStatus === "OK" ||
        input.message.configurationItem.configurationItemStatus === "ResourceDiscovered") {
        var ingressRules = input.message.configurationItem.configuration.ipPermissions,
            sgAclEntries = new BitArray(65535, 0),
            allowedPorts = getAllowedPorts(),
            index;
        for	(index = 0; index < ingressRules.length; index++) {
            sgAclEntries.setRange(ingressRules[index].fromPort, ingressRules[index].toPort, 1);
        }
        var diff = BitArray.getDifference(sgAclEntries, allowedPorts).toNumber();
        if (diff) {
            console.log("Creating sg result");
            result.evidence = [
                {
                    openedPorts: sgAclEntries.getIndexes().toString(),
                    reason: "Expected ports range: '" + allowedPorts.getIndexes().toString() + "'"
                }
            ];
            result.vulnerable = true;
            console.log("Creating security group vulnerability for '" + input.message.configurationItem.resourceId +
                        "': '" + JSON.stringify(result) + "'");
            return callback(null, result);
        }
    }
    console.log("Clearing security group vulnerability");
    return callback(null, result);
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
