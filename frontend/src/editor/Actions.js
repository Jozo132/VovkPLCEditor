const middle_mouse_drag = () => {
    let isDragging = false;
    let startX, startY, scrollLeft, scrollTop;
    let target = null;
    let prev_pointer = ''
    document.addEventListener("mousedown", function (e) {
        if (e.button !== 1) return; // Only trigger on middle mouse button
        // @ts-ignore
        target = e.target.closest(".plc-editor-body");
        if (!target) return console.error("No target found for middle mouse drag")

        e.preventDefault();
        isDragging = true;
        startX = e.pageX;
        startY = e.pageY;
        scrollLeft = target.scrollLeft;
        scrollTop = target.scrollTop;

        prev_pointer = target.style.cursor || ''
        target.style.cursor = "grabbing";
    });

    document.addEventListener("mousemove", function (e) {
        if (!isDragging) return;
        if (!target) return;
        e.preventDefault();
        const diff_x = e.pageX - startX;
        const diff_y = e.pageY - startY;
        // console.log('panning', { diff_x, diff_y })
        target.scrollLeft = scrollLeft - diff_x;
        target.scrollTop = scrollTop - diff_y;
    });

    document.addEventListener("mouseup", function (e) {
        if (!target) return;
        if (e.button !== 1) return;
        isDragging = false;
        target.style.cursor = prev_pointer
        target = null;
    });
}

// Resizable borders
const handle_resizer_drag = (event) => { // @ts-ignore
    if (!event || !event.target || !event.target.classList.contains("resizer")) return;

    const resizer = event.target; // @ts-ignore
    // const target = resizer.parentElement;
    // Find the closest parent with the class 'resizable'
    const target = resizer.closest('.resizable')
    if (!target) return console.error("No resizable parent found for resizer: ", resizer)
    event.preventDefault();
    const startX = event.clientX || event.touches && event.touches[0].clientX;
    const startY = event.clientY || event.touches && event.touches[0].clientY;
    const startWidth = target.offsetWidth;
    const startHeight = target.offsetHeight;

    const previous_pointer = target.style.cursor || '' // @ts-ignore
    target.style.cursor = resizer.classList.contains("right") || resizer.classList.contains("left") ? "col-resize" : "row-resize";

    const constrain = value => {
        return Math.min(Math.max(value, 200), 1000)
    }

    function onMouseMove(event) {
        const endX = event.clientX || event.touches && event.touches[0].clientX
        const endY = event.clientY || event.touches && event.touches[0].clientY// @ts-ignore
        if (resizer.classList.contains("right")) {
            const newWidth = constrain(startWidth + (endX - startX));
            target.style.width = newWidth + "px"; // @ts-ignore
        } else if (resizer.classList.contains("left")) {
            const newWidth = constrain(startWidth - (endX - startX));
            target.style.width = newWidth + "px"; // @ts-ignore
        } else if (resizer.classList.contains("bottom")) {
            const newHeight = constrain(startHeight + (endY - startY));
            target.style.height = newHeight + "px"; // @ts-ignore
        } else if (resizer.classList.contains("top")) {
            const newHeight = constrain(startHeight - (endY - startY));
            target.style.height = newHeight + "px";
        } else { // @ts-ignore
            console.error("Invalid resizer class: ", resizer.classList)
        }
    }

    function onMouseUp() {
        target.style.cursor = previous_pointer
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
        // Handle touch
        document.removeEventListener("touchmove", onMouseMove);
        document.removeEventListener("touchend", onMouseUp);
        document.removeEventListener("touchcancel", onMouseUp);
    }

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
    // Handle touch
    document.addEventListener("touchmove", onMouseMove, { passive: false });
    document.addEventListener("touchend", onMouseUp);
    document.addEventListener("touchcancel", onMouseUp);
}


const handleLongPress = (element, delay = 500) => {
    let timeout = null
    let target = null

    let start = {
        clientX: 0,
        clientY: 0
    }

    element.addEventListener("touchstart", (event) => {
        const touch = event.touches && event.touches[0];
        if (!touch) return;
        const { clientX, clientY } = touch;
        start = { clientX, clientY }
        target = event.target

        timeout = setTimeout(() => {
            const contextEvent = new MouseEvent("contextmenu", {
                bubbles: true,
                cancelable: true,
                view: window,
                clientX,
                clientY
            });
            target.dispatchEvent(contextEvent);
        }, delay);
    });

    element.addEventListener("touchend", () => {
        if (timeout) clearTimeout(timeout);
        timeout = null;
    });

    element.addEventListener("touchmove", (event) => {
        if (!event.touches || event.touches.length === 0) return;
        const distanceX = Math.abs(event.touches[0].clientX - start.clientX);
        const distanceY = Math.abs(event.touches[0].clientY - start.clientY);
        const distance = Math.sqrt(distanceX * distanceX + distanceY * distanceY);
        if (distance > 10) {
            if (timeout) clearTimeout(timeout);
            timeout = null;
        }
    });
}

export default class ActionsManager {
    static initialize = () => {
        // Enable middle-mouse drag support
        middle_mouse_drag()
        document.addEventListener("mousedown", handle_resizer_drag);
        document.addEventListener("touchstart", handle_resizer_drag, { passive: false });
        handleLongPress(document.body)
    }
}