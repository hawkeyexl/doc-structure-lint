
export class ValidationError {
  constructor(type, heading, message, position) {
    this.type = type;
    this.heading = heading;
    this.message = message;
    this.position = position;
  }
}