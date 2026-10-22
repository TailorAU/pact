declare module "d3-force-3d" {
  export function forceRadial(
    radius: number | ((node: any) => number),
    x?: number,
    y?: number,
    z?: number,
  ): {
    strength(s: number | ((node: any) => number)): any;
  };
}
