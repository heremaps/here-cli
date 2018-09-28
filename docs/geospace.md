
#### List all geospaces 

```
here geospace list
```

This command will list all the geospaces for which the user is authorized.

#### Create a new geospace 

```
here geospace create x-samplegeospace -t "sample test geospace" -d "sample creation"
```

Create a new geospace with name x-samplegeospace. 

##### Options 

-t title

-d description

#### Upload/Update  data to geospace 

```
here geospace upload x-testgeospace -f /Users/dhatb/data.geojson
```

Upload data to geospace with name x-testgeospace

##### Options 

-f path to file name

#### View a geospace 

```
here geospace show x-testgeospace
```

List the objects of a geospace 

##### Options 

-l limit count

-h offset handle 

#### Delete a geospace 

```
here geospace delete x-testgeospace
```

Delete a geospace on which the user is authorised to.

