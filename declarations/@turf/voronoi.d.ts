import { FeatureCollection, BBox, Point, Polygon } from '@turf/helpers';

/**
 * http://turfjs.org/docs/#voronoi
 * separate declaration file due to wrong typescript in voronoi - https://github.com/Turfjs/turf/issues/1422
 */
export default function voronoi(
    points: FeatureCollection<Point>,
    options: {bbox: BBox}
): FeatureCollection<Polygon>;
