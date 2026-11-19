export interface Length { readonly meters: number }
export interface Duration { readonly seconds: number }
export interface Mass { readonly kilograms: number }
export declare function fromFeet(feet: number): Length
export declare function fromMeters(meters: number): Length
export declare function toFeet(length: Length): number
export declare function toMeters(length: Length): number
export declare function fromMinutes(minutes: number): Duration
export declare function fromSeconds(seconds: number): Duration
export declare function toMinutes(duration: Duration): number
export declare function toSeconds(duration: Duration): number
export declare function fromPounds(pounds: number): Mass
export declare function fromKilograms(kilograms: number): Mass
export declare function toPounds(mass: Mass): number
export declare function toKilograms(mass: Mass): number
