
/*
 * Turing Simulator Main Control Script
 * Every instance contains the entire control logic for a single tape.
 * 
 * This should never ever directly access the DOM!
 * (c) 2016 jh
 */

class TuringControlError extends Error {
    constructor(id, info) {
        super();
        this.id = id || -1;
        this.info = info || {};
        this.message = this.format(this.DEFAULT_ERRORS[id]);
    }
    
    format(str) {
        for (let k in this.info)
            str = str.replace("{" + k + "}", this.info[k]);
        return str;
    }
    
    export() {
        var self = this;
        return {
            id: self.id,
            info: self.info
        };
    }
    
    static recreate(backup) {
        return new TuringControlError(backup.id, backup.info);
    }
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

class TuringControlMessage {
    constructor(type, info) {
        this.type = type;
        if (info) {
            this.status = info.status || null;
            this.error = info.error || null;
        }
    }
};

class TuringControl {
    constructor() {
        // internal
        this.programming;
        this.initialTape = "", this.initialOffset = 0;
        // step delay
        this.delay;
        this.timeout;
        // pseudo-consts
        this.HALT_STATE = "H";
        this.INIT_STATE = "1";
        this.BLANK_SYMBOL = "_";
        this.COMPUTE_TIMEOUT = 5000;
        // async worker (init on use)
        this.skipworker = null;

        // listeners
        this.listeners = {};
        // events
        this.events = {
            haltstate: new Event("haltstate"),
            uiupdate: new Event("uiupdate"),
            skipdone: new Event("skipdone"),
            skipinterrupt: new Event("skipinterrupt"),
            skiptimeout: new Event("skiptimeout")
        }; // runtimeerror (dynamic event)

        this.defaults();
    }

    defaults() {
        // runtime info
        this.state = this.INIT_STATE;
        this.position = 0;
        // stats
        this.transitions = 0;
        this.symbols = this.initialTape.replace(/ /g, "").length;
        this.lastDirection = this.DIRECTION_NONE;
        // unimplemented
        this.tapeStart = 0;
        this.tapeEnd = 0;
        // state
        this.running = false;
        this.skipping = false;
        this.haltState = false;
        // internal
        this.ltape = [], this.rtape = [];
        
        var ofst = this.initialOffset, str = this.initialTape;
        for (var i = 0; i < str.length; i++)
            this.setTape(ofst + i, str.charAt(i));
        
        this.dispatchEvent(this.events.uiupdate);
    }
    
    // checks if machine activity matches the requirements
    needs(requirements) {
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
    }
    
    getTape(index) {
        return (index < 0 ? this.ltape[~index] : this.rtape[index]) || " ";
    }
    
    setTape(index, value) {
        if (index < 0) {
            this.ltape[~index] = value;
        } else {
            this.rtape[index] = value;
        }
    }
    
    start() {
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
        setTimeout(schedule, 0);
    }
    
    halt() {
        this.needs({ running: true });
        if (this.skipping) {
            this.skipworker.postMessage(new TuringControlMessage("stop"));
        } else {
            clearTimeout(this.timeout);
            this.running = false;
            return true;
        }
        return false;
    }
    
    reset() {
        this.needs({ programmed: true, running: false });
        this.defaults();
    }
    
    step() {
        this.needs({ programmed: true, running: false, haltstate: false });
        this.transition();
        this.dispatchEvent(this.events.uiupdate);
    }
    
    compute() {
        this.needs({ programmed: true, running: false, haltstate: false });
        
        if (!Worker)
            throw new TuringControlError(12);
        
        if (!this.skipworker) {
            var self = this;
            this.skipworker = new Worker("resources/calculation.js");
            
            this.skipworker.addEventListener("message", function(e) {
                // alert(JSON.stringify(e.data));
                var msg = e.data;
                self.import(msg.status);
                self.skipping = false;
                self.running = false;
                self.dispatchEvent(self.events.uiupdate);
                
                switch (msg.type) {
                    case "error":
                        var event = new CustomEvent("runtimeerror", {
                            detail: TuringControlError.recreate(msg.error)
                        });
                        self.dispatchEvent(event);
                        self.haltState = true;
                        break;
                    case "interrupt":
                        self.dispatchEvent(self.events.skipinterrupt);
                        break;
                    case "done":
                        self.dispatchEvent(self.events.skipdone);
                        self.dispatchEvent(self.events.haltstate);
                        self.haltState = true;
                        break;
                    case "timeout":
                        self.dispatchEvent(self.events.skiptimeout);
                        break;
                }
                self.skipworker = null;
            });
        }
        
        this.running = true;
        this.skipping = true;
        this.skipworker.postMessage(new TuringControlMessage("start", {
            status: this.export(true)
        }));
    }
    
    init(program, initial, offset) {
        var COMMAND_PATTERN = /^\s*([0-9A-Za-z]{1,3}),([^, ]) +([0-9A-Za-z]{1,3}),([^, ])(?:,([>_<]))?\s*(?:#.*)?$/;
        
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
            
            var state = match[1].replace(/^0{0,2}(\d)/, "$1"); // leading zeros
            var char = match[2];
            var targetState = match[3].replace(/^0{0,2}(\d)/, "$1");
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
        for (var state of calledStates) {
            if (definedStates.indexOf(state) === -1 && state !== this.HALT_STATE)
                throw new TuringControlError(6, { state: state, line: calledByLine[state] });
        }
        
        if (definedStates.indexOf(this.INIT_STATE) === -1)
            throw new TuringControlError(7, { state: this.INIT_STATE });
        
        // compile-time check successful
        this.programming = programming;
        this.initialTape = initial;
        this.initialOffset = offset;
        
        this.defaults();
    }
    
    transition() {
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
            return false;
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
        return true;
    }
    
    // export/import
    export(env) {
        var ex = Object.create(null);
        for (let k of this.STATE_LIST)
            ex[k] = this[k];
        if (env)
            for (let k of this.ENV_LIST)
                ex[k] = this[k];
        return ex;
    }
    import(im, env) {
        for (let k of this.STATE_LIST)
            this[k] = im[k];
        if (env)
            for (let k of this.ENV_LIST)
                this[k] = im[k];
    }
    
    // event handling
    addEventListener(type, callback) {
        if (!(type in this.listeners))
            this.listeners[type] = [];
        this.listeners[type].push(callback);
    }
    removeEventListener(type, callback) {
        if (type in this.listeners) {
            this.listeners[type].forEach(function(item, i, arr) {
                if (item === callback)
                    arr.splice(i, 1);
            });
        }
    }
    dispatchEvent(event) {
        var self = this;
        if (event.type in this.listeners) {
            this.listeners[event.type].forEach(function(item) {
                item.call(self, event);
            });
        }
    }
};
TuringControl.prototype.STATE_LIST =
        ["state", "position", "transitions", "symbols", "lastDirection", "tapeStart", "tapeEnd", "ltape", "rtape"];
TuringControl.prototype.ENV_LIST =
        ["programming", "initialTape", "initialOffset", "HALT_STATE", "INIT_STATE", "BLANK_SYMBOL", "COMPUTE_TIMEOUT"];
TuringControl.prototype.DIRECTION_LEFT = -1;
TuringControl.prototype.DIRECTION_NONE = 0;
TuringControl.prototype.DIRECTION_RIGHT = 1;
