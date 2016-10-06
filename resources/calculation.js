/* 
 * Asynchronous calculation script.
 * 
 * (c) 2016 jh
 */

importScripts("turingsim3.js");

this.addEventListener("message", function(e) {
    // import data
    var TMS = new TuringControl();
    var data = JSON.parse(e.data);
    TMS.import(data);
    TMS.importInfo(data);
    
    var error = null;
    TMS.addEventListener("runtimeerror", function(e) {
        error = e;
    });
    
    // TODO implement timeout
    while (!TMS.haltState) {
        TMS.transition();
    }

    // communicate back
    var output = JSON.stringify(TMS.export());
    output.status = error ? "error" : "ok"; // add timeout
    output.error = error;
    postMessage(output);
    close();
});
