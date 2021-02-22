/*
  Copyright (C) 2018 - 2020 HERE Europe B.V.
  SPDX-License-Identifier: MIT

  Permission is hereby granted, free of charge, to any person obtaining
  a copy of this software and associated documentation files (the
  'Software'), to deal in the Software without restriction, including
  without limitation the rights to use, copy, modify, merge, publish,
  distribute, sublicense, and/or sell copies of the Software, and to
  permit persons to whom the Software is furnished to do so, subject to
  the following conditions:

  The above copyright notice and this permission notice shall be
  included in all copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED 'AS IS', WITHOUT WARRANTY OF ANY KIND,
  EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT.
  IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
  CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT,
  TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE
  SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/

import * as common from "./common";
import * as xyz from "./here-xyz";
import * as tmp from "tmp";
import * as fs from "fs";
import * as turf from "@turf/turf";
import {Delaunay} from "d3-delaunay";
import {getSpaceDataFromXyz} from "./xyz-serviceutils";

export async function performGisOperation(id:string, options:any){
    await common.verifyProLicense();
    const sourceId = id;
    options.totalRecords = Number.MAX_SAFE_INTEGER;
    options.currentHandleOnly = true;
    options.handle = 0;
    if(options.chunk){
        options.limit = options.chunk;
    } else {
        options.limit = 20;
    }
    if(!options['length'] && !options.centroid && !options.area && !options.voronoi && !options.delaunay){
        console.log("Please specify GIS operation option");
        process.exit(1);
    }
    if(options.neighbours && !options.delaunay){
        console.log("Error: --neighbours option is only valid --delaunay option");
        process.exit(1);
    }
    let cHandle;
    let gisFeatures : any[]= [];
    let featureCount = 0;
    let isValidGisFeatures = false;
    let delaunayFeaturesMap = new Map();
    console.log("Performing GIS operation on the space data");
    let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'gis', postfix: (options.voronoi || options.delaunay) ? '.geojson':'.geojsonl' });
    do {
        let jsonOut = await getSpaceDataFromXyz(id, options);
        if (jsonOut.features && jsonOut.features.length === 0 && options.handle == 0) {
            console.log("\nNo features are available to execute GIS operation");
            process.exit(1);
        }
        cHandle = jsonOut.handle;
        options.handle = jsonOut.handle;
        if (jsonOut.features) {
            const features = jsonOut.features;
            features.forEach(function (feature: any, i: number){
                if(options.voronoi || options.delaunay){
                    if(feature.geometry && (feature.geometry.type == 'Point')){
                        if(options.delaunay){
                            delaunayFeaturesMap.set(feature.geometry.coordinates.slice(0,2).toString(), feature);
                        } else {
                            gisFeatures.push(feature);
                        }
                    }
                } else {
                    let gisFeature = performTurfOperationOnFeature(feature, options);
                    if(gisFeature){
                        gisFeatures.push(gisFeature);
                        process.stdout.write("\rGIS operation done for feature count - " + (featureCount + (i+1)));
                    }
                }
            });
            featureCount += features.length;
            if(gisFeatures.length > 0 && !(options.voronoi || options.delaunay)){
                isValidGisFeatures = true;
                fs.appendFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }) + '\n');
                gisFeatures = [];
            }
        } else {
            cHandle = -1;
        }
    } while (cHandle >= 0);
    process.stdout.write("\n");
    if(options.delaunay){
        gisFeatures = Array.from(delaunayFeaturesMap.values());
    }
    if(gisFeatures.length == 0 && !isValidGisFeatures){
        console.log("required geometry features are not available to perform GIS operation");
        process.exit(1);
    }

    if(options.voronoi){
        console.log("Calculating Voronoi Polygons for points data");
        gisFeatures = await calculateVoronoiPolygon(id, gisFeatures, options);
        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }));
    } else if(options.delaunay){
        console.log("Performing delaunay operation on " + gisFeatures.length + " features");
        const delaunayFeatures = calculateDelaunayTriangles(gisFeatures, delaunayFeaturesMap, options.neighbours);
        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: delaunayFeatures }));
        if(options.neighbours){
            let neighboursTmpObj = tmp.fileSync({ mode: 0o644, prefix: 'gis', postfix: '.geojson'});
            fs.writeFileSync(neighboursTmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }));
            options.file = neighboursTmpObj.name;
            options.stream = true;
            console.log("updating Delaunay neighbours");
            await xyz.uploadToXyzSpace(id, options);
        }
    }
    if(!options.samespace && (options.centroid || options.voronoi || options.delaunay)){
        let newSpaceData;
        if(options.centroid){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('centroid', sourceId, options);
        } else if(options.voronoi){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('voronoi', sourceId, options);
        } else if(options.delaunay){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('delaunay', sourceId, options);
        }
        id = newSpaceData.id;
    }

    if (gisFeatures.length > 0 || isValidGisFeatures) {
        if(options.centroid){
            options.tags = 'centroid';
        } else if(options.voronoi){
            options.tags = 'voronoi';
        } else if(options.delaunay){
            options.tags = 'delaunay';
        }
        options.file = tmpObj.name;
        options.stream = true;
        await xyz.uploadToXyzSpace(id, options);
        console.log("GIS operation completed on space " + sourceId);
    }
}

function performTurfOperationOnFeature(feature: any, options: any){
    let gisFeature;
    if(options.centroid){
        if(feature.geometry && (feature.geometry.type == 'LineString' || feature.geometry.type == 'Polygon' || feature.geometry.type == 'MultiLineString' || feature.geometry.type == 'MultiPolygon')){
            gisFeature = turf.centroid(feature, feature.properties);
            if(options.samespace){
                if(!gisFeature.properties){
                    gisFeature.properties = {};
                }
                gisFeature.properties.sourceId = feature.id;
            } else {
                gisFeature.id = feature.id;
            }
        }
    } else if(options['length']){
        if(feature.geometry && (feature.geometry.type == 'LineString' || feature.geometry.type == 'MultiLineString')){
            let length = turf.length(feature, {units: 'meters'});
            if(!feature.properties){
                feature.properties = {};
            }
            feature.properties['xyz_length_m'] = length;
            feature.properties['xyz_length_km'] = parseFloat((length / 1000).toFixed(2));
            feature.properties['xyz_length_miles'] = parseFloat((length * 0.000621371).toFixed(2));
            gisFeature = feature;
        }
    } else if(options.area){
        if(feature.geometry && (feature.geometry.type == 'Polygon' || feature.geometry.type == 'MultiPolygon')){
            gisFeature = populateArea(feature);
        }
    } else {
        console.log("Please specify GIS operation option");
        process.exit(1);
    }
    return gisFeature;
}

function populateArea(feature: any){
    let area = turf.area(feature);
    if(!feature.properties){
        feature.properties = {};
    }
    feature.properties['xyz_area_sqm'] = area;
    feature.properties['xyz_area_sqkm'] = parseFloat((area / 1000000).toFixed(2));
    feature.properties['xyz_area_sqmiles'] = parseFloat((area * 0.00000038610215855).toFixed(2));
    return feature;
}

async function calculateVoronoiPolygon(spaceId: string, features: any[], options: any){
    const statData = await xyz.getSpaceStatistics(spaceId);
    const bbox: [number,number,number, number] = statData.bbox.value;
    const delaunay = Delaunay.from(features, function(feature){return feature.geometry.coordinates[0]}, function(feature){return feature.geometry.coordinates[1]});
    const voronoiResult = delaunay.voronoi(bbox).cellPolygons();
    let result = voronoiResult.next();
    let i = 0;
    let voronoiFeatures = [];
    while (!result.done) {
        //console.log(JSON.stringify(result.value));
        let polygon = turf.polygon([result.value],features[i].properties);
        if(options.samespace){
            if(!polygon.properties){
                polygon.properties = {};
            }
            polygon.properties.sourceId = features[i].id;
        } else {
            polygon.id = features[i].id;
        }
        polygon = populateArea(polygon);
        voronoiFeatures.push(polygon);
        result = voronoiResult.next();
        i++;
    }
    return voronoiFeatures;
}

function calculateDelaunayTriangles(features: any[], delaunayFeaturesMap: Map<string,any>, calculateNeighbours: boolean){
    const delaunay = Delaunay.from(features, function(feature){return feature.geometry.coordinates[0]}, function(feature){return feature.geometry.coordinates[1]});
    const delaunayResult = delaunay.trianglePolygons();
    let result = delaunayResult.next();
    let delaunayFeatures = [];
    while (!result.done) {
        //console.log(JSON.stringify(result.value));
        let properties = {
            a : delaunayFeaturesMap.get(result.value[0].toString()).id,
            b : delaunayFeaturesMap.get(result.value[1].toString()).id,
            c : delaunayFeaturesMap.get(result.value[2].toString()).id,
        }
        let polygon = turf.polygon([result.value], properties);
        polygon = populateArea(polygon);
        delaunayFeatures.push(polygon);
        result = delaunayResult.next();
    }
    if(calculateNeighbours){
        for(let i=0; i < features.length; i++){
            const neighbours = delaunay.neighbors(i);
            let neighbourResult = neighbours.next();
            let neighbourIds: string[] = [];
            while (!neighbourResult.done) {
                neighbourIds.push(features[neighbourResult.value].id);
                neighbourResult = neighbours.next();
            }
            features[i].properties['xyz_delaunay_neighbours'] = neighbourIds;
        }
    }
    return delaunayFeatures;
    /*
    const featureCollection = { type: "FeatureCollection", features: features };
    const tinFeatureCollection = turf.tin(featureCollection, property);
    tinFeatureCollection.features.forEach(function (polygon, i) {
        polygon = populateArea(polygon);
    });
    return tinFeatureCollection.features;
    */
}
