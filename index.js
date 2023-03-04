'use strict';

import express from 'express';
import fs from 'fs';
import { Storage } from '@google-cloud/storage';
import Handlebars from 'handlebars';

const storage = new Storage();
const bucket = storage.bucket('versatiles');
const template = Handlebars.compile(fs.readFileSync('index.html', 'utf8'));
const app = express();
app.disable('x-powered-by');

app.get(/.*/, async (req, res) => {
	let path = url2path(req.path);

	try {

		await sendFileList(path, res);
		return;

	} catch (error) {
		console.error({ path, error });
		return res.status(500).type('text').send('Internal Server Error');
	}
})

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => console.log(`listening on port ${PORT}`));

async function sendFileList(path, res) {
	let [files] = await bucket.getFiles({ prefix: path, autoPaginate: false, maxResults: 10000 });

	if (files.length === 0) {
		return res.status(404).type('text').send(`file not found`)
	}

	let entries = new Map();
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
			if (name.includes('/')) {
				let suffix = name.replace(/^.*?\//, '');
				if (!url.endsWith(suffix)) return;
				addLine(url.slice(0, -suffix.length), name.slice(0, -suffix.length));
				return; // ignore stuff in subfolders
			}
			addLine('/download' + url, name, parseInt(file.metadata.size, 10), file.metadata.timeCreated);
		}
	});

	function addLine(url, name, size, date) {
		if (entries.has(url)) return;
		
		if (size === undefined) {
			size = '';
		} else if (size < 1000) {
			size = size.toString()+' B'
		} else if (size < 1024*1024) {
			size = (size/(1024)).toFixed(2)+' KB'
		} else if (size < 1024*1024*1024) {
			size = (size/(1024*1024)).toFixed(2)+' MB'
		} else {
			size = (size/(1024*1024*1024)).toFixed(2)+' GB'
		}
		
		date = (date === undefined) ? '' : date.slice(0, 10) + ' ' + date.slice(11, 19);
		let order = url;
		if (url.startsWith('.')) order = '0' + order;
		else if (url.endsWith('/')) order = '1' + order;
		else order = '2' + order;
		entries.set(url, { order, url, name, size, date });
	}

	let html = template({
		path,
		entries: Array.from(entries.values()).sort((a, b) => a.order < b.order ? -1 : 1)
	});

	console.log('sendFileList: 200', path);
	res.set('cache-control', 'public, max-age=3600');
	res.set('content-type', 'text/html');
	res.status(200).send(html);
}

function url2path(url) {
	url = ('' + url).trim().replace(/^\/+/, '');
	url = decodeURI(url);
	return 'download/' + url;
}

function path2url(path) {
	path = ('' + path).trim().replace(/^\/+/, '');
	path = '/' + path.replace(/^download\//i, '');
	return path;
}
