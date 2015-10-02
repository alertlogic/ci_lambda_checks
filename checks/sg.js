var BitArray       = require('../utilities/bit_array.js'),
    config         = require('../config.js'),
    sg             = function(rawMessage)  {
    "use strict";

    if (rawMessage.configurationItem.configurationItemStatus === "OK") {
        var ingressRules = rawMessage.configurationItem.configuration.ipPermissions, sgAclEntries = new BitArray(65535, 0), index;
        for	(index = 0; index < ingressRules.length; index++) {
            sgAclEntries.setRange(ingressRules[index].fromPort, ingressRules[index].toPort, 1);
        }
        var diff = BitArray.getDifference(sgAclEntries, getAllowedPorts()).toNumber();
        if (diff) {
            console.log("Creating security group vulnerability");
            return true;
        }
    }
    console.log("Clearing security group vulnerability");
    return false;
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
