/* BitArray DataType */

// Constructor
var BitArray = function(size, bits) {
    "use strict";
    // Private field - array for our bits
    this.m_bits = [];

    //.ctor - initialize as a copy of an array of true/false or from a numeric value
    var i;
    if (bits && bits.length) {
        for (i = 0; i < bits.length; i++) {
            this.m_bits.push(bits[i] ? BitArray._ON : BitArray._OFF);
        }
    } else if (!isNaN(bits)) {
        this.m_bits = BitArray.shred(bits).m_bits;

    }
    if (size && this.m_bits.length !== size) {
        if (this.m_bits.length < size) {
            for (i = this.m_bits.length; i < size; i++) {
                this.m_bits.push(BitArray._OFF);
            }
        } else {
            for(i = size; i > this.m_bits.length; i--){
                this.m_bits.pop();
            }
        }
    }
};

/* BitArray PUBLIC INSTANCE METHODS */

// read-only property - number of bits
BitArray.prototype.getLength = function () {
    "use strict";
    return this.m_bits.length;
};

// accessor - get bit at index
BitArray.prototype.getAt = function (index) {
    "use strict";
    if (index < this.m_bits.length) {
        return this.m_bits[index];
    }
    return null;
};
// accessor - set bit at index
BitArray.prototype.setAt = function (index, value) {
    "use strict";
    if (index < this.m_bits.length) {
        this.m_bits[index] = value ? BitArray._ON : BitArray._OFF;
    }
};

// accessor - set bit from indexStart to indexEnd
BitArray.prototype.setRange = function (indexStart, indexEnd, Value) {
    "use strict";
    if (indexStart < this.m_bits.length) {
        if (indexEnd >= this.m_bits.length) {
            indexEnd = this.m_bits.length - 1;
        }
        for (var i = indexStart; i <= indexEnd; i++) {
            this.setAt(i, 1);
        }
    }
};

// resize the bit array (append new false/0 indexes)
BitArray.prototype.resize = function (newSize) {
    "use strict";
    var tmp = [];
    for (var i = 0; i < newSize; i++) {
        if (i < this.m_bits.length) {
            tmp.push(this.m_bits[i]);
        } else {
            tmp.push(BitArray._OFF);
        }
    }
    this.m_bits = tmp;
};

// Get the complimentary bit array (i.e., 01 compliments 10)
BitArray.prototype.getCompliment = function () {
    "use strict";
    var result = new BitArray(this.m_bits.length);
    for (var i = 0; i < this.m_bits.length; i++) {
        result.setAt(i, this.m_bits[i] ? BitArray._OFF : BitArray._ON);
    }
    return result;
};

// Get the string representation ("101010")
BitArray.prototype.toString = function () {
    "use strict";
    var s = ""; //new String();
    for (var i = 0; i < this.m_bits.length; i++) {
        s = s.concat(this.m_bits[i] === BitArray._ON ? "1" : "0");
    }
    return s;
};

// Get the numeric value
BitArray.prototype.toNumber = function () {
    "use strict";
    var pow = 0;
    var n = 0;
    for (var i = this.m_bits.length - 1; i >= 0; i--) {
        if (this.m_bits[i] === BitArray._ON) {
            n += Math.pow(2, pow);
        }
        pow++;
    }
    return n;
};

/* STATIC METHODS */

// Get the union of two bit arrays
BitArray.getUnion = function (bitArray1, bitArray2) {
    "use strict";
    var len = BitArray._getLen(bitArray1, bitArray2, true);
    var result = new BitArray(len);
    for (var i = 0; i < len; i++) {
        result.setAt(i, BitArray._union(bitArray1.getAt(i), bitArray2.getAt(i)));
    }
    return result;
};

// Get the intersection of two bit arrays
BitArray.getIntersection = function (bitArray1, bitArray2) {
    "use strict";
    var len = BitArray._getLen(bitArray1, bitArray2, true);
    var result = new BitArray(len);
    for (var i = 0; i < len; i++) {
        result.setAt(i, BitArray._intersect(bitArray1.getAt(i), bitArray2.getAt(i)));
    }
    return result;
};

// Get the difference between to bit arrays
BitArray.getDifference = function (bitArray1, bitArray2) {
    "use strict";
    var len = BitArray._getLen(bitArray1, bitArray2, true);
    var result = new BitArray(len);
    for (var i = 0; i < len; i++) {
        result.setAt(i, BitArray._difference(bitArray1.getAt(i), bitArray2.getAt(i)));
    }
    return result;
};


// Convert a number into a bit array
BitArray.shred = function (number) {
    "use strict";
    var bits = [];
    var q = number;
    do {
        bits.push(q % 2);
        q = Math.floor(q / 2);
    } while (q > 0);
    return new BitArray(bits.length, bits.reverse());
};

/* BitArray PRIVATE STATIC CONSTANTS */
BitArray._ON = 1;
BitArray._OFF = 0;

/* BitArray PRIVATE STATIC METHODS */

// Calculate the intersection of two bits
BitArray._intersect = function (bit1, bit2) {
    "use strict";
    return bit1 === BitArray._ON && bit2 === BitArray._ON ? BitArray._ON : BitArray._OFF;
};

// Calculate the union of two bits
BitArray._union = function (bit1, bit2) {
    "use strict";
    return bit1 === BitArray._ON || bit2 === BitArray._ON ? BitArray._ON : BitArray._OFF;
};

// Calculate the difference of two bits
BitArray._difference = function (bit1, bit2) {
    "use strict";
    return bit1 === BitArray._ON && bit2 !== BitArray._ON ? BitArray._ON : BitArray._OFF;
};

// Get the longest or shortest (smallest) length of the two bit arrays
BitArray._getLen = function (bitArray1, bitArray2, smallest) {
    "use strict";
    var l1 = bitArray1.getLength(),
        l2 = bitArray2.getLength();

    return l1 > l2 ? smallest ? l2 : l1 : smallest ? l2 : l1;
};

module.exports = BitArray;

/* END BitArray DataType */
