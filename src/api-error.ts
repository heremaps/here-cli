/**
 * A custom API error to denote the message along with the status code
 * 
 */
export class ApiError extends Error {
    statusCode: Number;
    /**
     * Constructs the ApiError class
     * @param {int} statusCode response status code from the api
     * @param {String} message response message from the api
     * @constructor
     */

     constructor(statusCode:Number, message:string) {
         super(message);
         this.statusCode = statusCode;
     }
}