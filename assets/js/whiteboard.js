export class Whiteboard {
  constructor(canvas, channel) {
    this.canvas = canvas;
    this.channel = channel;
    this.context = canvas.getContext('2d');
    this.drawing = false;
    this.color = 'black';
    this.mode = 'draw'; // 'draw' or 'erase'
    this.lastX = 0;
    this.lastY = 0;

    this.onMouseDown = this.onMouseDown.bind(this);
    this.onMouseMove = this.onMouseMove.bind(this);
    this.onMouseUp = this.onMouseUp.bind(this);
    this.onMouseOut = this.onMouseOut.bind(this);
  }

  init() {
    this.canvas.addEventListener('mousedown', this.onMouseDown);
    this.canvas.addEventListener('mousemove', this.onMouseMove);
    this.canvas.addEventListener('mouseup', this.onMouseUp);
    this.canvas.addEventListener('mouseout', this.onMouseOut);
  }

  destroy() {
    this.canvas.removeEventListener('mousedown', this.onMouseDown);
    this.canvas.removeEventListener('mousemove', this.onMouseMove);
    this.canvas.removeEventListener('mouseup', this.onMouseUp);
    this.canvas.removeEventListener('mouseout', this.onMouseOut);
  }

  resize() {
    // To avoid blurry rendering, we need to set the canvas width and height
    // attributes based on its display size.
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width;
    this.canvas.height = rect.height;
  }

  setColor(color) {
    this.color = color;
    this.mode = 'draw';
  }

  setMode(mode) {
    this.mode = mode;
  }

  onMouseDown(e) {
    this.drawing = true;
    const rect = this.canvas.getBoundingClientRect();
    this.lastX = e.clientX - rect.left;
    this.lastY = e.clientY - rect.top;
  }

  onMouseMove(e) {
    if (!this.drawing) return;

    const rect = this.canvas.getBoundingClientRect();
    const currentX = e.clientX - rect.left;
    const currentY = e.clientY - rect.top;

    const data = {
      x0: this.lastX / this.canvas.width,
      y0: this.lastY / this.canvas.height,
      x1: currentX / this.canvas.width,
      y1: currentY / this.canvas.height,
      color: this.color,
      mode: this.mode,
    };
    
    // Draw locally first
    this.draw(data);

    // Send to other peers
    this.channel.push('whiteboard_draw', data);

    this.lastX = currentX;
    this.lastY = currentY;
  }

  onMouseUp() {
    this.drawing = false;
  }
  
  onMouseOut() {
    this.drawing = false;
  }

  // This method is called to draw both locally and remote drawings
  draw(data) {
    const { x0, y0, x1, y1, color, mode } = data;
    this.context.beginPath();
    this.context.moveTo(x0 * this.canvas.width, y0 * this.canvas.height);
    this.context.lineTo(x1 * this.canvas.width, y1 * this.canvas.height);

    if (mode === 'erase') {
      this.context.strokeStyle = 'white'; // The "eraser" is just a white pen
      this.context.lineWidth = 20;
    } else {
      this.context.strokeStyle = color;
      this.context.lineWidth = 2;
    }

    this.context.stroke();
    this.context.closePath();
  }

  clear() {
    this.context.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
