
/*
 * Full tape view controller.
 * This is designed to be an extension of the default UI manager.
 * 
 * (c) 2016 jh
 */

class TapeView {
    constructor(turingcontrol) {
        this.control = turingcontrol;
        this.root = document.getElementById("fulltape");
        
        this.active = false;
        this.focusHead = true;
        this.focus = 0;
        this.maxdst = 10; // TODO set this to 100
        
        var self = this;
        
        this.control.addEventListener("uiupdate", () => self.build());
        
        document.getElementById("fulltileconfirm").addEventListener("click", () => self.changeFocus());
        document.getElementById("fullbutton").addEventListener("click", () => {
            self.active = !self.active;
            self.build();
            document.getElementById("fulltile").className = self.active ? "shown" : "";
        });
        
        this.changeFocus();
        this.build();
    }
    build() {
        if (!this.active) return;
        
        while(this.root.lastChild)
            this.root.removeChild(this.root.lastChild);
        
        var slider = document.createElement("div");
        slider.id = "fullslider";
        
        var pos = this.focusHead ? this.control.position : this.focus;
        
        var leftbound = pos - this.maxdst;
        var rightbound = pos + this.maxdst;
        
        // TODO start/end
        
        slider.style.width = (rightbound - leftbound + 3) * 40 + "px";
        
        
        // show one more position
        leftbound--;
        rightbound++;
        
        for (var i = leftbound; i <= rightbound; i++) {
            var index = i.toString();
            if (i > 0 && index.length > 5)
                index = "'" + index.substring(index.length - 5);
            if (i < 0 && index.length > 5)
                index = "-'" + index.substring(index.length - 4);
            slider.appendChild(this.createNode(index, this.control.getTape(index)));
        }
        this.root.appendChild(slider);
        
        document.getElementById("from").textContent = leftbound;
        document.getElementById("to").textContent = rightbound;
    }
    createNode(index, value) {
        var frame = document.createElement("div");
        frame.className = "valueframe";
        var val = document.createElement("div");
            val.className = "value";
            val.innerHTML = value;
        frame.appendChild(val);
        var idx = document.createElement("div");
            idx.className = "number";
            idx.innerHTML = index;
        frame.appendChild(idx);
        if (this.control.position - index === 0)
            frame.className += " currentpos";
        return frame;
    }
    changeFocus() {
        var pos = document.getElementById("fulltapepos").value;
        if (pos === "") {
            this.focusHead = true;
            this.build();
        } else if (!isNaN(pos) && isFinite(pos)) {
            this.focusHead = false;
            this.focus = Number(pos);
            this.build();
        }
    }
};
