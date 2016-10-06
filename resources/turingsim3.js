
/*
 * Turing Simulator Main Control Script
 * Every instance contains the entire control logic for a single tape.
 * 
 * This should never ever directly access the DOM!
 * (c) 2016 jh
 */

function TuringControlError(id, info) {
    this.id = id || -1;
    this.info = info || {};
    this.message = this.format(this.DEFAULT_ERRORS[id]);
}
TuringControlError.prototype = Object.create(Error.prototype);
TuringControlError.prototype.name = "TuringControlError";
TuringControlError.prototype.format = function(str) {
    var info = this.info;
    Object.keys(info).forEach(function(k) {
        str = str.replace("{" + k + "}", info[k]);
    });
    return str;
};
TuringControlError.prototype.DEFAULT_ERRORS = {
    1: "Cannot install program while running!",
    2: "Syntax error in line {line}.",
    3: "Attempting to override halt state in line {line}!",
    4: "Trying to override existing state transition in line {line}!",
    5: "No program code entered.",
    6: "Potential call to undefined state {state} in line {line}!",
    7: "No transition rules found for initial state {state}.",
    8: "TMS has not been programmed yet!",
    9: "Not running!",
    10: "Already running!",
    11: "Halt state reached.",
    12: "This feature is not supported by your browser.",
    13: "No applicable transition found for '{symbol}' in state {state}.",
    14: "Invalid offset specified."
};

function TuringControl() {
    if (!(this instanceof TuringControl))
        return new TuringControl();
    
    // runtime information
    this.state, this.position;
    // stats
    // TODO implement start/end
    this.transitions, this.symbols, this.lastDirection, this.tapeStart, this.tapeEnd;
    // listeners
    this.listeners = {};
    // events
    this.events = {
        haltstate: new Event("haltstate"),
        uiupdate: new Event("uiupdate"),
        skipdone: new Event("skipdone"),
        skipinterrupt: new Event("skipinterrupt"),
        skiptimeout: new Event("skiptimeout")
    };
    // dynamic events: runtimeerror (stores error info)
    
    // internals
    this.programming;
    this.initialTape = "", this.initialOffset = 0;
    this.ltape, this.rtape;
    // state
    this.running, this.skipping, this.haltState;
    // step delay
    this.delay;
    this.timeout;
    // pseudo-consts
    this.HALT_STATE = "H";
    this.INIT_STATE = "1";
    this.BLANK_SYMBOL = "_";
    this.DEFAULT_TIMEOUT = 10000;
    // async worker (init on first use)
    this.skipworker = null;
    
    this.defaults();
};

TuringControl.prototype = {
    defaults: function() {
        this.state = this.INIT_STATE;
        this.position = 0;
        this.transitions = 0;
        this.symbols = this.initialTape.replace(/ /g, "").length;
        this.lastDirection = this.DIRECTION_NONE;
        this.tapeStart = 0;
        this.tapeEnd = 0;
        this.running = false;
        this.skipping = false;
        this.haltState = false;
        this.ltape = [], this.rtape = [];
        
        var ofst = this.initialOffset, str = this.initialTape;
        for (var i = 0; i < str.length; i++)
            this.setTape(ofst + i, str.charAt(i));
        
        this.dispatchEvent(this.events.uiupdate);
    },

    // checks if machine activity matches the requirements
    needs: function(requirements) {
        if (typeof requirements.programmed !== "undefined") {
            if (typeof this.programming === "undefined" && requirements.programmed)
                throw new TuringControlError(8);
        }
        if (typeof requirements.running !== "undefined") {
            if (this.running ^ requirements.running)
                throw new TuringControlError(requirements.running ? 9 : 10);
        }
        if (typeof requirements.haltstate !== "undefined") {
            if (this.haltState && !requirements.haltstate)
                throw new TuringControlError(11);
        }
    },
    
    getTape: function(index) {
        return (index < 0 ? this.ltape[~index] : this.rtape[index]) || " ";
    },
    
    setTape: function(index, value) {
        if (index < 0) {
            this.ltape[~index] = value;
        } else {
            this.rtape[index] = value;
        }
    },
    
    start: function() {
        this.needs({ programmed: true, running: false, haltstate: false });
        this.running = true;
        
        var self = this;
        function schedule() {
            self.transition();
            self.dispatchEvent(self.events.uiupdate);
            if (!self.haltState) {
                self.timeout = setTimeout(schedule, self.delay);
            } else {
                self.running = false;
                self.haltState = true;
            }
        }
        schedule();
    },
    
    halt: function() {
        this.needs({ running: true });
        if (this.skipping) {
            // TODO terminate properly and receive state
            this.skipworker.terminate();
            this.skipworker = null;
            this.skipping = false;
        } else {
            clearTimeout(this.timeout);
        }
        this.running = false;
    },
    
    reset: function() {
        this.needs({ programmed: true, running: false });
        this.defaults();
    },
    
    step: function() {
        this.needs({ programmed: true, running: false, haltstate: false });
        this.transition();
        this.dispatchEvent(this.events.uiupdate);
    },
    
    compute: function(timeout) {
        this.needs({ programmed: true, running: false, haltstate: false });
        timeout = timeout || this.DEFAULT_TIMEOUT;
        
        if (!Worker)
            throw new TuringControlError(12);
        
        if (!this.skipworker) {
            var self = this;
            this.skipworker = new Worker("resources/calculation.js");
            this.skipworker.addEventListener("message", function(e) {
                var msg = JSON.parse(e.data);
                self.import(msg);
                self.skipping = false;
                self.running = false;
                self.dispatchEvent(self.events.uiupdate);
                
                if (msg.status === "error") {
                    var event = new CustomEvent("runtimeerror", {
                        detail: msg.error
                    });
                    self.dispatchEvent(event);
                    self.haltState = true;
                } else {
                    self.dispatchEvent(self.events.skipdone);
                    self.dispatchEvent(self.events.haltstate);
                    self.haltState = true;
                }
                self.skipworker = null;
            });
        }
        
        this.running = true;
        this.skipping = true;
        this.skipworker.postMessage(JSON.stringify(this.export()));
    },
    
    init: function(program, initial, offset) {
        COMMAND_PATTERN = /^\s*([0-9A-Za-z]{1,3}),([^, ]) +([0-9A-Za-z]{1,3}),([^, ])(?:,([>_<]))?\s*(?:#.*)?$/;
        
        if (this.running || this.skipping)
            throw new TuringControlError(1);

        offset = (typeof offset === "undefined") ? 0 : Number(offset);
        if (!isFinite(offset))
            throw new TuringControlError(14);        
        
        var programming = {};
        
        var calledStates = []; // those should exist
        var calledByLine = {};
        
        var empty = false;
        var lines = program.split(/\r?\n/g);
        
        for (var l = 0; l < lines.length; l++) {
            if (/^\s*$/.exec(lines[l])) // empty lines
                continue;
            if (/^\s*#.*$/.exec(lines[l])) // comment lines
                continue;
            
            var match = COMMAND_PATTERN.exec(lines[l]);
            if (!match)
                throw new TuringControlError(2, { line: l + 1 });
            
            var state = match[1].replace(/^0{0,2}/, "").toUpperCase(); // leading zeroes
            var char = match[2];
            var targetState = match[3].replace(/^0{0,2}/, "").toUpperCase();
            var newChar = match[4];
            var dirChar = match[5] || "_";
            var direction = (dirChar === ">") ? this.DIRECTION_RIGHT :
                            (dirChar === "<") ? this.DIRECTION_LEFT : this.DIRECTION_NONE;
            
            if (state === this.HALT_STATE)
                throw new TuringControlError(3, { line: l + 1 });
            
            if (!programming[state])
                programming[state] = {};
            
            if (programming[state][char])
                throw new TuringControlError(4, { line: l + 1 });
            
            programming[state][char] = {
                state: targetState,
                char: newChar,
                direction: direction
            };
            
            if (calledStates.indexOf(targetState) === -1)
                calledStates.push(targetState);
            if (!calledByLine[targetState])
                calledByLine[targetState] = l + 1;
            
            empty = false;
        }
                
        if (empty)
            throw new TuringControlError(5);
        
        // check for calls to undefined states
        var definedStates = Object.keys(programming);
        var haltState = this.HALT_STATE;
        calledStates.forEach(function(state) {
            if (definedStates.indexOf(state) === -1 && state !== haltState)
                throw new TuringControlError(6, { state: state, line: calledByLine[state] });
        });
        
        if (definedStates.indexOf(this.INIT_STATE) === -1)
            throw new TuringControlError(7, { state: this.INIT_STATE });
        
        // compile-time check successful
        this.programming = programming;
        this.initialTape = initial;
        this.initialOffset = offset;
        
        this.defaults();
    },
    
    transition: function() {
        var char = this.getTape(this.position);
        if (char === " ")
            char = this.BLANK_SYMBOL;
        
        var targetState = this.programming[this.state][char];
        if (!targetState) {
            this.haltState = true;
            
            var event = new CustomEvent("runtimeerror", {
                detail: new TuringControlError(13, { state: this.state, symbol: char })
            });
            this.lastDirection = this.DIRECTION_NONE;
            this.dispatchEvent(event);
            return;
        }
        
        var newChar = targetState.char;
        this.setTape(this.position, (newChar === this.BLANK_SYMBOL) ? " " : newChar);
        
        if (char === this.BLANK_SYMBOL && newChar !== this.BLANK_SYMBOL)
            this.symbols++;
        if (char !== this.BLANK_SYMBOL && newChar === this.BLANK_SYMBOL)
            this.symbols--;
        
        this.state = targetState.state;
        this.position += targetState.direction;
        this.lastDirection = targetState.direction;
        this.transitions++;
        
        if (this.state === this.HALT_STATE) {
            this.haltState = true;
            this.dispatchEvent(this.events.haltstate);
        }
    },
    
    // export/import
    export: function() {
        var ex = Object.create(null);
        for (var k of this.EXPORT_LIST)
            ex[k] = this[k];
        for (var k of this.INFO_LIST)
            ex[k] = this[k];
        return ex;
    },
    import: function(im) {
        for (var k of this.EXPORT_LIST)
            this[k] = im[k];
    },
    importInfo: function(info) {
        for (var k of this.INFO_LIST)
            this[k] = info[k];
    },
    
    // event handling
    addEventListener: function(type, callback) {
        if (!(type in this.listeners))
            this.listeners[type] = [];
        this.listeners[type].push(callback);
    },
    removeEventListener: function(type, callback) {
        if (type in this.listeners) {
            this.listeners[type].forEach(function(item, i, arr) {
                if (item === callback)
                    arr.splice(i, 1);
            });
        }
    },
    dispatchEvent: function(event) {
        var self = this;
        if (event.type in this.listeners) {
            event.target = this;
            this.listeners[event.type].forEach(function(item) {
                item.call(self, event);
            });
        }
    }
    
};
TuringControl.prototype.EXPORT_LIST = ["state", "position", "transitions", "symbols", "lastDirection",
    "tapeStart", "tapeEnd", "ltape", "rtape"];
TuringControl.prototype.INFO_LIST = ["programming", "HALT_STATE", "INIT_STATE", "BLANK_SYMBOL", "DEFAULT_TIMEOUT"];
TuringControl.prototype.DIRECTION_LEFT = -1;
TuringControl.prototype.DIRECTION_NONE = 0;
TuringControl.prototype.DIRECTION_RIGHT = 1;

TuringControl.prototype.constructor = TuringControl;
