/** Injectable time source so services can be tested with a fixed or advancing clock. */
export type Clock = () => Date;

export const systemClock: Clock = () => new Date();
