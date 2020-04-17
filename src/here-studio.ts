#!/usr/bin/env node

/*
  Copyright (C) 2018 - 2019 HERE Europe B.V.
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

import * as common from './common';
import {ApiError} from "./api-error";
import * as _ from "lodash";

import * as fs from "fs";

import * as program from 'commander';

import {getSpaceDataFromXyz, uploadToXyzSpace, handleError, execute, createSpace} from "./xyzCommon";

const prompter = require('prompt');
const commands = ["list", "clone", "open"];

program
    .version('0.1.0');


program
    .command("list")
    .description("information about available XYZ Studio Projects")
    .action(async function (options) {
        listProjects(options)
            .catch((error: any) => {
                handleError(error);
            })
    });

program
    .command("delete <project-id>")
    .description("delete the project with the given id")
    .action(async (geospaceId, options) => {
        deleteProject(geospaceId, options)
            .catch((error) => {
                handleError(error, true);
            })
    });

program
    .command("show <project-id>")
    .description("Open the project with the given id")
    .action(async (geospaceId, options) => {
        showProject (geospaceId, options)
            .catch((error) => {
                handleError(error);
            })
    });

program
    .command("clone <project-id>")
    .description("Open the project with the given id")
    .action(async (geospaceId, options) => {
        cloneProject (geospaceId, options)
            .catch((error) => {
                handleError(error);
            })
    });


//cloneProject - cloning projects for studio
//
//- Get the token from ProjectAPI and have a reference of currentUser’s token
// https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7
//
//     - Take the spaceIDs from ProjectAPI
// - Download / save response all features from the shared space from viewer url
// https://xyz.api.here.com/hub/spaces/mOXoWyWn/search?margin=20&clip=false&clientId=viewer&access_token=AFSmufxGTfOGWwZQF11aiwA&limit=100000
//     - Repeat downloading if multiple GeospaceIDs exists
//
// - Upload the file to new existing current user’s workspace
// - Create the project for existing user
// - Optionally - Copy layer styles that exists from older project
async function cloneProject  (id : any, options: any) {

    //Extract the ID if user has passed in the Viewer URL otherwise the input will be treated as id
    if (id.startsWith("http")) {
        id = getParameterByName("project_id", id)
    }

    //- Get the token from ProjectAPI and have a reference of currentUser’s token from below ProjectAPI GET URL // GET - https://xyz.api.here.com/project-api/projects/82764d11-e84a-40f6-b477-12d8041ccdb7  / // GET - https://studio.here.com/viewer/?project_id=3a02af56-aa75-400c-b886-36aa8d046c08 //id = "3a02af56-aa75-400c-b886-36aa8d046c08"/ b4d1126a-fc12-4406-b506-692ace752d52
    let uri = "/project-api/projects/"+id;
    console.log("Cloning project : "+id);
    let cType = "";

    let { response, body } = await execute(uri, "GET", cType, "", options.token, false, false);

    response.body = JSON.parse(response.body);

    //Fetch the current token from user's published project
    let publishersToken = response.body.rot;
    let currentUsersToken = await common.verify();

    //Create a new project for currentUser copying all the response body of past users data //POST - ProjectsAPI with response.body of to-be cloned project
    uri = "/project-api/projects";
    cType = "application/json"

    //Remove id attribute before post call, the new project which will be created for current user with this data
    delete response.body.id;

    let clonedProjectData = response.body;

    //Get the GeoSpace-ID(s) of all the layers from published projects
    let updatedLayersData = [];
    for (let i=0; i < clonedProjectData.layers.length; i++) {

        //Get the current layer
        let currentLayer = clonedProjectData.layers[i];

        //Check if the layer has tags eg. Building Footprints tags -> In Such cases copy the whole currentLayer as is -> Otherwise copy the space from the user
        if (currentLayer.meta
            && currentLayer.meta.tags
            && currentLayer.meta.tags.length > 0) {

            //Update the project layer as is without any modifications
            updatedLayersData.push(currentLayer)
        }
        else {

            //Download the space locally and reference the space for current user
            let geoSpaceIDToCopy = currentLayer.geospace.id;
            console.log("\nCopying layer ["+(i+1)+"] : '"+geoSpaceIDToCopy+"' from published project")

            //Download the GeospaceID from published project with the publisher's token -  Download the space from GET Search and save it in local temp file - https://xyz.api.here.com/hub/spaces/uLqEizJW/search
            let geoSpaceDownloadOptions = {
                token : publishersToken
            }
            let geoSpaceData = await getSpaceDataFromXyz(geoSpaceIDToCopy, geoSpaceDownloadOptions);
            if (geoSpaceData.features && geoSpaceData.features.length === 0) {
                console.log("\nNo features are available to download");
                //process.exit();
            }

            //Check if GeoSpaceData is blank -> if yes move on to next one else create the file with that name
            let geoSpaceFileName = geoSpaceIDToCopy+".geojson";
            await fs.writeFileSync(geoSpaceFileName, JSON.stringify(geoSpaceData));
            console.log("Space '"+geoSpaceIDToCopy+"' downloaded locally")

            //Copy the contents of the downloaded space to currentUser's XYZ spaces
            let newSpaceData = await createSpace ({})//createNewSpaceAndUpdateMetadata(''+geoSpaceIDToCopy, ""+geoSpaceIDToCopy, {});
            let currentGeoSpaceID = newSpaceData.id;

            //Update the geospace id for current layer
            currentLayer.geospace.id = currentGeoSpaceID;

            let uploadOptions = {
                title: geoSpaceFileName,
                description: "GeoSpace created from HERE CLI",
                file: geoSpaceFileName,
                stream: true
            }

            //Upload it to current user's space
            await uploadToXyzSpace (currentGeoSpaceID, uploadOptions);

            //Clear cache and delete the file from temp repo
            await fs.unlinkSync(geoSpaceFileName)

            //Update the modified layer data.
            updatedLayersData.push(currentLayer)
        }
    }

    //Create a new project under current user with the settings of published projects
    uri = "/project-api/projects";

    //Update the layer data to cloned project - updatedLayersData
    clonedProjectData.layers = updatedLayersData;

    //Update the token for current project
    clonedProjectData.rot = currentUsersToken;

    let { response:newProjectResponse, body:newProjectBody } = await execute(uri, "POST", cType, clonedProjectData, options.token);

    let studioBaseURL = "https://studio.here.com";
    let clonedProjectURL = studioBaseURL+"/studio/project/"+newProjectBody.id;

    //Viewer URL - /https://studio.here.com/viewer/?project_id=b1e3a9d4-116b-407b-b99f-17fbdf48d405
    let viewerURL = studioBaseURL+"/viewer/?project_id="+newProjectBody.id
    if (newProjectResponse.statusCode == 201) {
        console.log("\n**** Successfully cloned ******")
        console.log("Project cloned in your studio account : "+clonedProjectURL)
        console.log("Viewer URL : "+viewerURL)
    }
}

//Will capture URL Query string parameters from URL
function getParameterByName (name: any, url: any) {
    if (!url) return null;
    name = name.replace(/[\[\]]/g, '\\$&');
    var regex = new RegExp('[?&]' + name + '(=([^&#]*)|&|#|$)'),
        results = regex.exec(url);
    if (!results) return null;
    if (!results[2]) return '';
    return decodeURIComponent(results[2].replace(/\+/g, ' '));
}

async function showProject (id : any, options: any) {
    const opn = require("opn");
    opn(
        "https://xyz.here.com/viewer/?project_id="+id
        , { wait: false });
}

async function deleteProject  (id : any, options: any) {
    console.log("Deleting project : "+id)

    //If project exists send a DELETE request for that projectID
    const uri = "/project-api/projects/"+id;
    const cType = "";
    let { response, body } = await execute (uri, "DELETE", cType, "", options.token);

    if (response && response.statusCode === 204) {
        console.log("Successfully deleted project.")
    }
    else {
        console.log("Unable to delete project having project-id: "+id)
    }
}


/**
 * Will list all the projects for the given user in below format
 *
 * @param options
 */
export async function listProjects (options: any) {
    console.log("Please wait; Fetching your list of projects...")
    const uri = "/project-api/projects";
    const cType = "";//"application/json";//
    let { response, body } = await execute(uri, "GET", cType, "", options.token);
    if (body.length == 0) {
        console.log("No xyz projects found");
    } else {
        let fields = ["id", "title", "status"];

        body = JSON.parse(body);

        //Flattened array of project JsonObjects containing info about name, id and description, add any other info later as necessary
        let extractProjectInfo: any[] = new Array();

        //Iterate through all the projects and extract meta information in extractColumns Array having JSON Objects with keys of id, name and description,
        _.forEach(body, (currentProject: { status: string; id: string; meta: { name: any; description: any; }; }) => {

            //Check whether meta info like project description and name exists for that project? - > If exists Push the meta info with id in new
            if (_.has(currentProject, 'meta')) {
                let viewerURL = "";
                if (currentProject.status.toUpperCase() === "PUBLISHED") {
                    viewerURL = "https://xyz.here.com/viewer/?project_id=" + currentProject.id;
                }
                let currentProjectDetails = {
                    id: currentProject.id,
                    title: currentProject.meta.name,
                    description: currentProject.meta.description,
                    status: currentProject.status,
                    viewerURL
                }
                extractProjectInfo.push(new Object(currentProjectDetails))
            }
        })

        //List the project
        common.drawNewTable(extractProjectInfo, fields, [40, 25, 12]);
    }
}

common.validate(commands, [process.argv[2]], program);
prompter.stop();
program.parse(process.argv);
if (!program.args.length) {
    common.verify();
}
