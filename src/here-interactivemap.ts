#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2021 HERE Europe B.V.
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
import * as program from "commander";
import * as common from "./common";
import * as xyzutil from "./xyzutil";
import * as catalogUtil from "./catalogUtil";
import * as inquirer from "inquirer";
import {ConfigApi} from "@here/olp-sdk-dataservice-api";

const catalogConfirmationPrompt = [
    {
        type: 'confirm',
        name: 'catalogConfirmation',
        message: 'Do you want to use existing catalog?',
        default: true
    }
];

const newCatalogCreationPrompt = [
    {
        type: 'input',
        name: 'id',
        message: 'Enter an id for the new catalog: '
    },
    {
        type: 'input',
        name: 'catalogName',
        message: 'Enter a Name for the new catalog: '
    },
    {
        type: 'input',
        name: 'summary',
        message: 'Enter a summary for the new catalog: '
    },
    {
        type: 'input',
        name: 'message',
        message: 'Enter a description for the new catalog: '
    }
];

program.version("0.1.0");

program
    .command("create [catalogHrn]")
    .description("create a new Interactive Map layer")
    .requiredOption("-i, --id <id>", "Id for Interactive Map layer")
    .requiredOption("-n, --layerName <layerName>", "Name for Interactive Map layer")
    .option("-s, --summary <summary>", "Short summary")
    .option("-m, --message <message>", "Description for Interactive Map layer")
    .option("-p, --searchableProperties <searchableProperties>", "a comma separated list of properties to be indexed for faster queries")
    .option("--tags <tags>", "a comma separated list of tags")
    .option("--billingTags <billingTags>", "a comma separated list of billing tags")
    .option("--token <token>", "a external token to create layer in other user's account")
    .action(async function (catalogHrn, options) {
        if (!options.summary) {
            options.summary = "a new Interactive map layer created from commandline";
        }
        if (!options.message) {
            options.message = "a new Interactive map layer created from commandline";
        }
        try {
            if(!catalogHrn){
                const catalogInput = await inquirer.prompt<{ catalogConfirmation?: boolean }>(catalogConfirmationPrompt);
                if(!catalogInput.catalogConfirmation){
                    let catalogOptions = await inquirer.prompt(newCatalogCreationPrompt);
                    catalogOptions.token = options.token;
                    const layer = catalogUtil.getLayerObject(options);
                    await catalogUtil.createCatalog(catalogOptions, [layer]);
                } else {
                    let catalogs = await catalogUtil.getCatalogs(false,options.token);
                    let catalogChoiceList : { name: string, value: string }[] = [];
                    if(catalogs){
                        for(let catalog of (catalogs as Array<ConfigApi.CatalogSummary>)){
                            catalogChoiceList.push({
                                name: catalog.title + " - " + catalog.hrn,
                                value : catalog.hrn + ""
                            })
                        }
                    }
                    const catalogQuestion = [
                        {
                            type: "list",
                            name: "catalogHrn",
                            message: "Please select the catalog",
                            choices: catalogChoiceList
                        }
                    ];
                    catalogHrn = (await inquirer.prompt<{catalogHrn:string}>(catalogQuestion)).catalogHrn;
                }
            }
            if(catalogHrn){
                await catalogUtil.createInteractiveMapLayer(catalogHrn, options, options.token);
            }
        } catch(error){
            common.handleError(error);
        };
    });


program
    .command("config [catalogHrn] [layerId]")
    .description("configure/update an Interactive Map layer in a catalog")
    .option("-n, --layerName <layerName>", "Name for Interactive Map layer")
    .option("-s, --summary <summary>", "Short summary")
    .option("-m, --message <message>", "Description for Interactive Map layer")
    .option("-p, --searchableProperties <searchableProperties>", "a comma separated list of properties to be indexed for faster queries")
    .option("--tags <tags>", "a comma separated list of tags")
    .option("--billingTags <billingTags>", "a comma separated list of billing tags")
    .option("--token <token>", "a external token to create layer in other user's account")
    .action(async function (catalogHrn, layerId, options) {
        try {
            const catLayer = await catalogUtil.catalogLayerSelectionPrompt(catalogHrn, layerId, options);
            
            if(catLayer.catalogHrn && catLayer.layerId){
                let layer: any = catLayer.catalog?.layers.find(x => x.id === catLayer.layerId);
                if(!options.summary) {
                    options.summary = layer.summary;
                }
                await catalogUtil.updateInteractiveMapLayer(catLayer.catalogHrn, catLayer.layerId, options, options.token);
            }
        } catch(error){
            common.handleError(error);
        };
    });


program
    .command("upload [catalogHrn] [layerId]")
    .description("upload one or more GeoJSON, CSV, GPX, XLS, or a Shapefile to the given layerid. GeoJSON feature IDs will be respected unless you override with -o or specify with -i; pipe GeoJSON via stdout using | here iml upload <catalogHrn> <layerId>")
    .option("-f, --file <file>", "comma separated list of local GeoJSON, GeoJSONL, Shapefile, CSV, GPX, or XLS files (or GeoJSON/CSV URLs); use a directory path and --batch [filetype] to upload all files of that type within a directory")
    .option("-c, --chunk [chunk]", "chunk size, default 200 -- use smaller values (1 to 10) to allow safer uploads of very large geometries (big polygons, many properties), use higher values (e.g. 500 to 5000) for faster uploads of small geometries (points and lines, few properties)")
    .option("--token <token>", "a external token to upload data to another user's layer")
    .option("-x, --lon [lon]", "longitude field name")
    .option("-y, --lat [lat]", "latitude field name")
    .option("-z, --point [point]", "points field name with coordinates like (Latitude,Longitude) e.g. (37.7,-122.4)")
    .option("--lonlat", "parse a -—point/-z csv field as (lon,lat) instead of (lat,lon)")
    .option("-i, --id [id]", "property name(s) to be used as the feature ID (must be unique) -- multiple values can be comma separated")
    // TODO: Either remove --assign option or modify assign to remove tags - Removing for now
    //.option("-a, --assign","interactive mode to analyze and select fields to be used as tags and unique feature IDs")
    .option("-o, --override", "override default feature ID and use property hash feature ID generation")
    .option("-s, --stream", "streaming support for upload  and/or large csv and geojson uploads using concurrent writes, tune chunk size with -c")
    .option('-d, --delimiter [,]', 'alternate delimiter used in CSV', ',')
    .option('-q, --quote ["]', 'quote used in CSV', '"')
    .option('-e, --errors', 'print data upload errors')
    .option('--string-fields <stringFields>', 'property name(s) of CSV string fields *not* to be automatically converted into numbers or booleans (e.g. number-like census geoids, postal codes with leading zeros)')
    .option('--groupby <groupby>', 'consolidate multiple rows of a CSV into a single feature based on a unique ID designated with -i; values of each row within the selected column will become top level properties within the consolidated feature')
    .option('--promote <promote>', 'comma separated column names which should not be nested within a top level property generated consolidated by --groupby')
    .option('--flatten', 'stores the --groupby consolidated output in flattened string separated by colon (:) instead of a nested object')
    .option('--date <date>', 'date-related property name(s) of a feature to be normalized as a ISO 8601 datestring (datahub_iso8601_[propertyname]), and unix timestamp (datahub_timestamp_[propertyname] ')
    .option('--dateprops [datepropsString]', 'comma separated list of granular date properties to be added via --date. possible options - year, month, week, weekday, year_month, year_week, hour')
    .option('--noCoords', 'upload CSV files with no coordinates, generates null geometry and tagged with null_island (best used with -i)')
    .option('--batch [batch]', 'upload all files of the same type within a directory; specify "--batch [geojson|geojsonl|csv|shp|gpx|xls]" (will inspect shapefile subdirectories); select directory with -f')
    .action(async function (catalogHrn, layerId, options) {
        
        const catLayer = await catalogUtil.catalogLayerSelectionPrompt(catalogHrn, layerId, options);

        if(catLayer.catalogHrn && catLayer.layerId) {
            xyzutil.setCatalogHrn(catLayer.catalogHrn);
            xyzutil.uploadToXyzSpace(catLayer.layerId, options).catch((error) => {
                common.handleError(error, true);
            });
        }
    });

program
    .command("list")
    .alias("ls")
    .description("information about available Interactive map layers")
    .option("-r, --raw", "show raw layer definition")
    .option("--token <token>", "a external token to access another user's layers")
    .option("--filter <filter>", "a comma separted strings to filter layers")
    .action(async function (options) {
        try {
            let catalogs = await catalogUtil.getCatalogs(true,options.token);
            if (!catalogs || catalogs.length == 0) {
                console.log("No layers found");
            } else {
                let layers: any[] = [];
                for(let catalog of (catalogs as Array<ConfigApi.Catalog>)){
                    layers = layers.concat(catalog.layers.filter((element: any) => {//TODO - change it to ConfigApi.Layer once layerType issue is resolved
                        if(element.layerType == "interactivemap"){
                            if(options.filter){
                                const filterArray = options.filter.split(",");
                                for (var i=0; i<filterArray.length; i++) {
                                    if(element.id && element.id.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1 || (element.name && element.name.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1)
                                            || (element.description && element.description.toLowerCase().indexOf(filterArray[i].toLowerCase()) != -1)){
                                        return true;
                                    }
                                }
                            } else {
                                return true;
                            }
                        }
                    }));
                }
                if (options.raw) {
                    console.log(JSON.stringify(layers, null, 2));
                } else {
                    let fields = ["id", "name", "description", "summary", "hrn"];
                    common.drawNewTable(layers, fields, [20, 20, 30, 30, 30]);
                }
            }
        } catch(error) {
            common.handleError(error);
        }
    });

program
    .command("show <catalogHrn> <id>")
    .description("shows the content of the given [id]")
    .option("-l, --limit <limit>", "Number of objects to be fetched")
    .option("-o, --offset <offset>", "The offset / handle to continue the iteration")
    //.option("-t, --tags <tags>", "Tags to filter on")
    .option("-r, --raw", "show raw Interactive Map layer content")
    .option("--all", "iterate over entire Interactive Map layer to get entire data of layer, output will be shown on the console in GeoJSON format")
    .option("--geojsonl", "to print output of --all in geojsonl format")
    .option("-c, --chunk [chunk]", "chunk size to use in --all option, default 5000")
    .option("--token <token>", "a external token to access another user's layer")
    .option("-p, --prop <prop>", "selection of properties, use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt>")
    //.option("-w, --web", "display Data Hub space on http://geojson.tools")
    //.option("-v, --vector", "inspect and analyze using Data Hub Space Invader and tangram.js")
    //.option("-x, --permanent", "uses Permanent token for --web and --vector option")
    .option("-s, --search <propfilter>", "search expression in \"double quotes\", use single quote to signify string value,  use p.<FEATUREPROP> or f.<id/updatedAt/tags/createdAt> (Use '+' for AND , Operators : >,<,<=,<=,=,!=) (use comma separated values to search multiple values of a property) {e.g. \"p.name=John,Tom+p.age<50+p.phone='9999999'+p.zipcode=123456\"}")
    .option("--spatial","perform a spatial search on a layer using --center, --feature, or --geometry")
    .option("--h3 <h3>","h3 resolution level to be used to iterate through a large spatial search on a space")
    //.option("--saveHexbins","save the h3 hexbin geometries used to iterate through a large spatial layer on a space")
    //.option("--targetSpace [targetSpace]","target space id where the results of h3 spatial search will be written")
    .option("--radius <radius>", "the radius to be used with a --spatial --center search, or to add a buffer to a line or polygon (in meters)")
    .option("--center <center>", "comma separated, double-quoted lon,lat values specifying the center point of a --radius search")
    .option("--feature <feature>", "comma separated 'catalogHrn,layerId,featureid' values specifying a reference geometry in another layer for a spatial query")
    .option("--geometry <geometry>", "geometry file to be uploaded for a --spatial query (a single feature in geojson file)")
    .action(async function (catalogHrn, id, options) {
        await catalogUtil.validateCatalogAndLayer(catalogHrn, id);//validate catalogHrn and layerId
        xyzutil.setCatalogHrn(catalogHrn);
        xyzutil.showSpace(id, options)
            .catch((error) => {
                common.handleError(error, true);
            });
    });

program
    .command("delete <catalogHrn> <layerId>")
    .description("delete the Interactive map layer with the given id")
    .option("--force", "skip the confirmation prompt")
    .option("--token <token>", "a external token to delete another user's layer")
    .action(async (catalogHrn, layerId, options) => {
        const catalog = await catalogUtil.validateCatalogAndLayer(catalogHrn, layerId);//validate catalogHrn and layerId
        const layer = catalog.layers.find(layer => layer.id === layerId);

        xyzutil.setCatalogHrn(catalogHrn);
        xyzutil.setLayer(layer);
        xyzutil.deleteSpace(layerId, options)
            .catch((error) => {
                common.handleError(error, true);
            })
    });

program
    .command("clear <catalogHrn> <layerId>")
    .description("clear data from Interactive map layer")
    //.option("-t, --tags <tags>", "tags for the Data Hub space")
    .option("-i, --ids <ids>", "IDs for the Interactive map layer")
    .option("--token <token>", "a external token to clear another user's layer data")
    .option("--force", "skip the confirmation prompt")
    .action(async (catalogHrn, layerId, options) => {
        await catalogUtil.validateCatalogAndLayer(catalogHrn, layerId);//validate catalogHrn and layerId
        xyzutil.setCatalogHrn(catalogHrn);
        xyzutil.clearSpace(layerId, options).catch((error) => {
            common.handleError(error, true);
        })
    });

program
    .command("token")
    .description("Get workspace token")
    //.option("--console","opens web console for Data Hub")
    .action(async (options) => {
        try {
            console.log(await common.getWorkspaceToken());
        } catch(error) {
            common.handleError(error);
        };
    });

common.validate(
    [
        "upload",
        "show",
        "delete",
        "clear",
        "token",
        "create",
        "config",
        "list",
        "ls"
    ],
    [process.argv[2]],
    program
);
program.name('here iml').parse(process.argv);