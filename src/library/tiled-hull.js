import hulljs from "hull.js"; // JS extension required
import PolygonEdge from "./polygon-edge";

/**
 * A function to take a tilemap layer and process its tiles into clusters. This returns an array of
 * polygons - each polygon encloses a separate cluster of tiles in the tilemap layer.
 *
 * @param {Phaser.TilemapLayer} tilemapLayer The tilemap layer to use for hull calculation.
 * @param {object} [options = {}] Options for filtering the tiles and only allowing certain tiles to
 * be added to the final hulls. If no options specified, then all tiles in the layer will be
 * processed and added to a hull. If multiple options are specified, then a tile only has to match
 * ONE of the options to be added to a hull.
 * @param {number[]} [options.tileIndices = null] An array of tile indices to use for determining
 * which tiles should be clustered together. If a tile's index matches an index in the array, it
 * will be added to a hull.
 * @param {string} [options.tileProperty = null] The name of a property on tiles (set in Tiled) to
 * use for determining which tiles should be clustered together. If the property is true (or truthy)
 * on a tile, it will be added to a hull.
 * @param {boolean} [options.checkCollide = false] Whether or not a tile's collide property should
 * be used for determining which tiles should be clustered together. If true, then colliding tiles
 * will be added to a hull.
 * @returns {Array.<PolygonEdge[]>} An array where each element represents a polygon. The polygons
 * are stored as an array of PolygonEdge instances.
 */
export default function phaserTiledHull(tilemapLayer, {tileIndices = null, tileProperty = null, 
        checkCollide = false} = {}) {
    // Separate the tilemap layer into an array of clustered tiles
    const clusters = calculateClusters(tilemapLayer, tileIndices, tileProperty, checkCollide);
    // Take the clustered tiles and calculate a hull for each cluster
    const pointHulls = calculateHullPoints(clusters);
    // Take the point hulls and turn them into polygon representations (i.e. connect the dots)
    const polyHulls = buildPolygons(pointHulls);
    // Turn the lines in polyHulls into PolygonEdge instances, pre-caching some helpful info like
    // the edge normals
    const hulls = [];
    for (const [i, polyHull] of polyHulls.entries()) {
        const hull = [];
        for (const edge of polyHull) {
            hull.push(new PolygonEdge(edge, i));
        }
        hulls.push(hull);
    }
    return hulls;
}

function calculateClusters(tilemapLayer, tileIndices, tileProperty, checkCollide) {
    const tilemap = tilemapLayer.map;
    const clusters = [];
    const getTile = (tx, ty) => tilemap.getTile(tx, ty, tilemapLayer.index);
    
    // Loop over all tiles in the map and kick off recursive cluster building
    for (var x = 0; x < tilemap.width; x++) {
        for (var y = 0; y < tilemap.height; y++) {
            const tile = getTile(x, y);
            if (checkTile(tile) && !findTileInClusters(tile)) {
                const cluster = [];
                recursivelySearchNeighbors(x, y, cluster);
                clusters.push(cluster);
            }
        }
    }

    // Check to make sure the tile passes the checks, i.e. it is allowed to be in a cluster
    function checkTile(tile) {
        // No tile, ignore
        if (!tile) return false;
        // If an array of indices was provided, tile's index must be in that array
        if (tileIndices && tileIndices.includes(tile.index)) return true;
        // If a tile property was provided, the tile must have a truthy value for that property
        if (tileProperty && tile.properties[tileProperty]) return true;
        // If we only care about colliding tiles, make sure the tile collides
        if (checkCollide && tile.collides) return true;
        // Tile didn't pass any checks, ignore
        return false;
    }

    function recursivelySearchNeighbors(x, y, cluster) {
        // If tile passes the checks and is not already in the cluster, add it and recursively check
        // the neighbors. Note: There's no chance of a tile being a member of two separate clusters.
        const tile = getTile(x, y);
        if (checkTile(tile) && (cluster.indexOf(tile) === -1)) {
            cluster.push(tile); // Add the current tile
            // Search the neighbors
            recursivelySearchNeighbors(x, y - 1, cluster);
            recursivelySearchNeighbors(x, y + 1, cluster);
            recursivelySearchNeighbors(x + 1, y, cluster);
            recursivelySearchNeighbors(x - 1, y, cluster);
        }
    }

    function findTileInClusters(searchTile) {
        for (const cluster of clusters) {
            for (const tile of cluster) {
                if (searchTile === tile) return cluster;
            }
        }
        return null;
    }

    return clusters;
}

function calculateHullPoints(clusters) {
    const hulls = [];

    // Loop over each cluster of tiles in clusters and calculate a polygon hull
    for (const cluster of clusters) {
        // Find all the points - i.e. the corners of each tile in the cluster
        const points = [];
        for (const tile of cluster) {
            points.push(
                [tile.left, tile.top],
                [tile.right, tile.top],                
                [tile.left, tile.bottom],                
                [tile.right, tile.bottom]
            );
        }

        // Use hull.js to find a hull (e.g. points in clockwise order). The second parameter is the 
        // concavity of the hull, with 1 being maximally concave.  
        const hull = hulljs(points, 1);
        hulls.push(hull);
    }

    return hulls;
}

function buildPolygons(hulls) {
    const polygons = [];

    for (const hullPoints of hulls) {
        const edges = [];

        // Walk along the line segments of the hull, collapsing collinear lines into a single edge
        let currentEdge = new Phaser.Line(...hullPoints[0], ...hullPoints[1]);
        let segment;
        for (let i = 1; i < hullPoints.length; i++) {
            // Get the next line segment - starts from the endpoint of the last segment
            segment = new Phaser.Line(...hullPoints[i - 1], ...hullPoints[i]);

            if (checkIfCollinear(currentEdge, segment)) {
                // If the current edge and line segment are collinear, then we haven't reached the
                // end of the edge yet. Extend the edge to contain the segment.
                currentEdge = new Phaser.Line(
                    currentEdge.start.x, currentEdge.start.y, segment.end.x, segment.end.y
                );
            } else {
                // We've reached a corner, so the edge is done. Save it and start a new one.
                edges.push(currentEdge);
                currentEdge = segment.clone();             
            }
        }

        // Process the last line segment - connecting the last point back around to the first point
        segment = new Phaser.Line(...hullPoints[hullPoints.length - 1], ...hullPoints[0]);
        if (checkIfCollinear(currentEdge, segment)) {
            // Extend the edge and add it (since it wasn't added by the loop above)
            currentEdge = new Phaser.Line(
                currentEdge.start.x, currentEdge.start.y, segment.end.x, segment.end.y
            );
            edges.push(currentEdge);
        } else {
            // Corner - add the edge and the next segment 
            edges.push(currentEdge);
            edges.push(segment);
        }

        // Determine whether the last edge and the first edge need to be merged (if the points in
        // the hull started midway through an edge)
        if (checkIfCollinear(edges[0], edges[edges.length - 1])) {
            const firstLine = edges.shift();
            const lastLine = edges.pop();
            var combinedLine = new Phaser.Line(
                firstLine.start.x, firstLine.start.y, lastLine.end.x, lastLine.end.y
            );
            edges.push(combinedLine);
        }

        // Add the final lines to the polygon
        polygons.push(edges);
    }
    
    return polygons;
}

function checkIfCollinear(line1, line2) {
    // To check if two slopes are equal:
    //  lineDeltaY / lineDeltaX = segmentDeltaY / segmentDeltaX
    // But to avoid dividing by zero:
    //  (lineDeltaX * segmentDeltaY) - (lineDeltaY * segmentDeltaX) = 0
    const dx1 = line1.end.x - line1.start.x;
    const dy1 = line1.end.y - line1.start.y;
    const dx2 = line2.end.x - line2.start.x;
    const dy2 = line2.end.y - line2.start.y;
    return ((dx1 * dy2) - (dy1 * dx2)) === 0;
}