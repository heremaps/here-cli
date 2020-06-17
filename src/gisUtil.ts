import * as common from "./common";
import * as xyz from "./here-xyz";
import * as tmp from "tmp";
import * as fs from "fs";
import * as turf from "@turf/turf";
import {Delaunay} from "d3-delaunay";

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
    if(!options['length'] && !options.centroid && !options.area && !options.voronoi && !options.tin){
        console.log("Please specify GIS operation option");
        process.exit(1);
    }
    let cHandle;
    let gisFeatures : any[]= [];
    let featureCount = 0;
    let isValidGisFeatures = false;
    let tinFeaturesMap = new Map();
    console.log("Performing GIS operation on the space data");
    let tmpObj = tmp.fileSync({ mode: 0o644, prefix: 'gis', postfix: (options.voronoi || options.tin) ? '.geojson':'.geojsonl' });
    do {
        let jsonOut = await xyz.getSpaceDataFromXyz(id, options);
        if (jsonOut.features && jsonOut.features.length === 0 && options.handle == 0) {
            console.log("\nNo features are available to execute GIS operation");
            process.exit(1);
        }
        cHandle = jsonOut.handle;
        options.handle = jsonOut.handle;
        if (jsonOut.features) {
            const features = jsonOut.features;
            features.forEach(function (feature: any, i: number){
                if(options.voronoi || options.tin){
                    if(feature.geometry && (feature.geometry.type == 'Point')){
                        if(options.tin){
                            tinFeaturesMap.set(feature.geometry.coordinates.slice(0,2).toString(), feature);
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
            if(gisFeatures.length > 0 && !(options.voronoi || options.tin)){
                isValidGisFeatures = true;
                fs.appendFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }) + '\n');
                gisFeatures = [];
            }
        } else {
            cHandle = -1;
        }
    } while (cHandle >= 0);
    process.stdout.write("\n");
    if(options.tin){
        gisFeatures = Array.from(tinFeaturesMap.values());
    }
    if(gisFeatures.length == 0 && !isValidGisFeatures){
        console.log("required geometry features are not available to perform GIS operation");
        process.exit(1);
    }

    if(options.voronoi){
        console.log("Calculating Voronoi Polygons for points data");
        gisFeatures = await calculateVoronoiPolygon(id, gisFeatures, options);
        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }));
    } else if(options.tin){
        console.log("performing tin operation on " + gisFeatures.length + " features");
        gisFeatures = calculateTinTriangles(gisFeatures, tinFeaturesMap, options.property);
        fs.writeFileSync(tmpObj.name, JSON.stringify({ type: "FeatureCollection", features: gisFeatures }));
    }
    if(!options.samespace && (options.centroid || options.voronoi || options.tin)){
        let newSpaceData;
        if(options.centroid){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('centroid', sourceId, options);
        } else if(options.voronoi){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('voronoi', sourceId, options);
        } else if(options.tin){
            newSpaceData = await xyz.createNewSpaceAndUpdateMetadata('tin', sourceId, options);
        }
        id = newSpaceData.id;
    }

    if (gisFeatures.length > 0 || isValidGisFeatures) {
        if(options.centroid){
            options.tags = 'centroid';
        } else if(options.voronoi){
            options.tags = 'voronoi';
        } else if(options.tin){
            options.tags = 'tin';
        }
        options.file = tmpObj.name;
        options.override = true;
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
            feature.properties['datahub_length_m'] = length;
            feature.properties['datahub_length_km'] = parseFloat((length / 1000).toFixed(2));
            feature.properties['datahub_length_miles'] = parseFloat((length * 0.000621371).toFixed(2));
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
    feature.properties['datahub_area_sqm'] = area;
    feature.properties['datahub_area_sqkm'] = parseFloat((area / 1000000).toFixed(2));
    feature.properties['datahub_area_sqmiles'] = parseFloat((area * 0.00000038610215855).toFixed(2));
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

function calculateTinTriangles(features: any[], tinFeaturesMap: Map<string,any>, property: string){
    const delaunay = Delaunay.from(features, function(feature){return feature.geometry.coordinates[0]}, function(feature){return feature.geometry.coordinates[1]});
    const tinResult = delaunay.trianglePolygons();
    let result = tinResult.next();
    let tinFeatures = [];
    while (!result.done) {
        //console.log(JSON.stringify(result.value));
        let properties = {
            a : tinFeaturesMap.get(result.value[0].toString()).id,
            b : tinFeaturesMap.get(result.value[1].toString()).id,
            c : tinFeaturesMap.get(result.value[2].toString()).id,
        }
        let polygon = turf.polygon([result.value], properties);
        polygon = populateArea(polygon);
        tinFeatures.push(polygon);
        result = tinResult.next();
    }
    return tinFeatures;
    /*
    const featureCollection = { type: "FeatureCollection", features: features };
    const tinFeatureCollection = turf.tin(featureCollection, property);
    tinFeatureCollection.features.forEach(function (polygon, i) {
        polygon = populateArea(polygon);
    });
    return tinFeatureCollection.features;
    */
}
