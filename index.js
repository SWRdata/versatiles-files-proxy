'use strict';

import express from 'express';
import { Storage } from '@google-cloud/storage';

const storage = new Storage();
const bucket = storage.bucket('versatiles');
const app = express();
app.disable('x-powered-by');

app.get(/.*/, async (req, res) => {
	let path = url2path(req.path);

	try {

		if ((path.length === 0) || path.endsWith('/')) {
			await sendFileList(path, res);
		} else {
			await sendFile(path, req, res);
		}
		return;

	} catch (error) {
		console.error({ path, error });
		return res.status(500).type('text').send('Internal Server Error');
	}
})

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`listening on port ${PORT}`));



async function sendFile(path, req, res) {
	let file = bucket.file(path);

	if (!(await file.exists())[0]) {
		// try list view 
		return await sendFileList(path + '/', res);
	}

	let [metadata] = (await file.getMetadata());
	let { size, contentType, etag } = metadata;

	res.set('cache-control', 'public, max-age=' + (86400 * 7));
	res.set('accept-ranges', 'bytes');
	res.set('content-type', contentType || 'application/octet-stream');
	if (etag) res.set('etag', etag);

	let range = req.range();
	if (range) {
		// handle range requests
		let { start, end } = range[0];

		if ((start > end) || (end >= size)) {
			// handle invalid range requests
			console.log('sendFile: 416', path);
			res.status(416);
			res.set('content-range', `bytes */${size}`);
			res.end();
			return;
		}

		console.log('sendFile: 206', path);
		res.set('content-range', `bytes ${start}-${end}/${size}`);
		res.set('content-length', end - start + 1);
		//console.log(res);
		res.status(206);
		file.createReadStream({ start, end }).pipe(res);
	} else {
		// handle normal requests
		console.log('sendFile: 200', path);

		res.set('transfer-encoding', 'chunked');
		res.status(200);
		file.createReadStream().pipe(res);
	}
}

async function sendFileList(path, res) {
	let [files] = await bucket.getFiles({ prefix: path, autoPaginate: false, maxResults: 10000 });

	if (files.length === 0) {
		return res.status(404).type('text').send(`file not found`)
	}


	let table = [];
	let url = path2url(path);
	if (url.length > 1) addLine(path2url(path.replace(/\/[^\/]*\/$/, '/')), '..');

	files.forEach(file => {
		let name = file.name;
		if (!name.startsWith(path)) return;
		name = name.slice(path.length);
		if (name.length === 0) return;

		let url = path2url(file.name);

		if (name.endsWith('/')) { // handle folder
			if (name.slice(0, -1).includes('/')) return; // ignore stuff in subfolders
			addLine(url, name);
		} else { // handle file
			if (name.includes('/')) return; // ignore stuff in subfolders
			addLine(url, name, parseInt(file.metadata.size, 10), file.metadata.timeCreated);
		}
	});

	function addLine(url, name, size, date) {
		size = (size === undefined) ? '' : Math.ceil(size / 1048576).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '\'') + ' MB';
		date = (date === undefined) ? '' : date.slice(0, 10) + ' ' + date.slice(11, 19);
		table.push(`<tr><td><a href="${url}">${name}</a></td><td>${size}</td><td>${date}</td><tr>`);
	}

	let html = [
		'<html>',
		'<head>',
		'<style>',
		'body { font-family: sans-serif }',
		'table { border-collapse: collapse; margin: 100px auto 0 }',
		'table tr:nth-child(2) td { padding-top: 10px }',
		'table th { border-bottom: 1px solid #aaa }',
		'table td { padding: 3px 10px;  }',
		'table td:nth-child(1) { text-align: left; min-width: 200px }',
		'table td:nth-child(2) { text-align: right; min-width: 100px }',
		'table td:nth-child(3) { text-align: center; min-width: 160px }',
		'</style>',
		'</head>',
		'<body>',
		'<table>',
		'<tr><th>filename</th><th>size</th><th>date</th></tr>',
		...table,
		'</table>',
		'</body>',
		'</html>',
	].join('\n');

	console.log('sendFileList: 200', path);
	res.set('cache-control', 'public, max-age=300');
	res.set('content-type', 'text/html');
	res.status(200).send(html);
}

function url2path(url) {
	url = ('' + url).trim().replace(/^\/+/, '');
	url = decodeURI(url);
	return 'files/' + url;
}

function path2url(path) {
	path = ('' + path).trim().replace(/^\/+/, '');
	path = '/' + path.replace(/^files\//i, '');
	return path;
}
