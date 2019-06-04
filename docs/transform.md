#### Transform csv to geojson 
- ##### Convert the provided csv file as geojson
```
here transform csv2geo /Users/dhatb/mapcli_publish/mapcli/bin/test.csv output.geojson
```
The output file name is optional if not specified the command will log the geojson
###### system will try to autodetect the latitude and longitude fieldname from the following matched field names.
- longitude ->  "x", "xcoord", "xcoordinate", "coordx", "coordinatex", "longitude", "lon"
- latitudde -> "y", "ycoord", "ycoordinate", "coordy", "coordinatey", "latitude", "lat"

##### Options 
-y, --lat [lat]  latitude field name
-x, --lon [lon]  longitude field name

#### Transform shapefile to geojson 
- ##### Convert the provided shape file as geojson
```
here transform shp2geo /Users/dhatb/mapcli_publish/mapcli/bin/test.shp output.geojson
```
The output file name is optional if not specified the command will log the geojson
