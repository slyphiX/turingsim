/* 
 * Asynchronous calculation script.
 * 
 * (c) 2016 jh
 */

importScripts("turingsim3.js");

var TMS;
var RUNS = 1000;

this.addEventListener("message", function(e) {
    
    var msg = e.data;
    
    // stop command issued
    if (msg.type === "stop") {
        postMessage(new TuringControlMessage("interrupt", {
            status: TMS.export()
        }));
        close();
    }
    if (msg.type === "start") {
        // import data
        TMS = new TuringControl();
        TMS.import(msg.status, true);
        
        // runtime error occurred
        TMS.addEventListener("runtimeerror", function(ev) {
            postMessage(new TuringControlMessage("error", {
                status: TMS.export(),
                error: ev.detail.export()
            }));
            close();
        });

        var worker = this;
        var ok;
        function run() {
            // run actual operations
            for (var i = RUNS; i && !TMS.haltState; i--)
                ok = TMS.transition();
            
            if (!ok) return;
            
            // halt state reached
            if (TMS.haltState) {
                worker.postMessage(new TuringControlMessage("done", {
                    status: TMS.export()
                }));
                worker.close();
            }
            // taking too long
            else if (Date.now() - start > TMS.COMPUTE_TIMEOUT) {
                worker.postMessage(new TuringControlMessage("timeout", {
                    status: TMS.export()
                }));
                worker.close();
            }
            // else requeue
            else {
                worker.setTimeout(run, 0);
            }
        }
        
        var start = Date.now();
        setTimeout(run, 0);
    }
});
