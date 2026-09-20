/** A deliberate policy stop (classification markings). Every other failure
 * to scan a file degrades to a notice instead of interrupting the upload.
 */
export class UploadBlocked extends Error {}
