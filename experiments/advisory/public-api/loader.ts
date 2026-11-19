export interface Image { readonly width: number; readonly height: number }
export declare function loadImage(bytes: Uint8Array): Promise<Image>
export default loadImage
