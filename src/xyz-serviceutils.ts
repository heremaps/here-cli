
import * as common from "./common";


const bboxDirections = ["west", "south", "east", "north"];

export async function execute(uri: string, method: string, contentType: string, data: any, token: string | null = null, gzip: boolean = false) {
    if (!token) {
        token = await common.verify();
    }
    return await common.execInternal(uri, method, contentType, data, token, gzip, true);
}

export function replaceOpearators(expr: string) {
    return expr.replace(">=", "=gte=").replace("<=", "=lte=").replace(">", "=gt=").replace("<", "=lt=").replace("+", "&");
}

export function getSpaceDataFromXyz(id: string, options: any) {
    return new Promise<any>(function (resolve, reject) {
        let cType = "application/json";
        if (!options.limit) {
            options.limit = 5000;
        }
        const getUrI = function (offset: string) {
            let uri = "/hub/spaces/" + id;
            let spFunction;
            if (options.bbox) {
                spFunction = "bbox";
                options.limit = 100000;//Max limit of records space api supports 
            } else if(options.search) {
                spFunction = "search"
            } else {
                spFunction = "iterate";
            }
            if (options.limit) {
                uri = uri + "/" + spFunction + "?limit=" + options.limit + "&clientId=cli";
                if (options.bbox) {
                    var bboxarray = options.bbox.split(",");
                    if (bboxarray.length !== 4) {
                        console.error(`\nboundingbox input size is not proper - "${options.bbox}"`);
                        process.exit(1);
                    }
                    bboxarray.forEach(function (item: string, i: number) {
                        if (item && item != "") {
                            let number = parseFloat(item.toLowerCase());
                            if (isNaN(number)) {
                                console.error(`\nLoading space data using bounding box failed - "${item}" is not a valid number`);
                                process.exit(1);
                            }
                            uri = uri + "&" + bboxDirections[i] + "=" + number;
                        }
                    });
                }
                if(options.search){
                    uri = uri + "&" + replaceOpearators(options.search);
                }
                if (offset && offset !== '0') {
                    uri = uri + "&handle=" + offset;
                }
                if (options.tags) {
                    uri = uri + "&tags=" + options.tags;
                }
            }
            return uri;
        };
        if (!options.totalRecords) {
            options.totalRecords = 500000;
        }
        let recordLength = 0;
        let features = new Array();
        let jsonOut;
        (async () => {

            try {
                let cHandle = options.handle ? options.handle : 0;
                if (cHandle === 0 && !options.ignoreLogs) {
                    process.stdout.write("Operation may take a while. Please wait...");
                }
                do {
                    if(!options.ignoreLogs){
                        process.stdout.write(".");
                    }
                    let response = await execute(
                        getUrI(String(cHandle)),
                        "GET",
                        cType,
                        "",
                        options.token,
                        true
                    );
                    jsonOut = response.body;
                    if (jsonOut.constructor !== {}.constructor) {
                        jsonOut = JSON.parse(jsonOut);
                    }
                    cHandle = jsonOut.handle;
                    if (jsonOut.features) {
                        recordLength += jsonOut.features.length;
                        features = features.concat(jsonOut.features);
                    } else {
                        cHandle = -1;
                    }
                    if (options.currentHandleOnly) {
                        cHandle = -1;
                        break;
                    }
                } while (cHandle >= 0 && recordLength < options.totalRecords);
                if (!options.currentHandleOnly && !options.ignoreLogs) {
                    process.stdout.write("\n");
                }
                jsonOut.features = features;
                resolve(jsonOut);
            } catch (error) {
                console.error(`\ngetting data from Data Hub space failed: ${JSON.stringify(error)}`);
                reject(error);
            }
        })();
    });
}
