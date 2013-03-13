var async = require('async');
var _ = require('underscore');
var extend = require('extend');

RegExp.quote = require('regexp-quote');

module.exports = function(options, callback) {
  return new pages(options, callback);
};

function pages(options, callback) {
  var apos = options.apos;
  var app = options.app;
  var self = this;
  var aposPages = this;

  // Usage: app.get('*', pages.serve({ typePath: __dirname + '/views/pages' }))
  //
  // If you use this global wildcard route, make it your LAST route,
  // as otherwise it overrides everything else.
  //
  // If you want to mount your pages as a "subdirectory:"
  //
  // app.get('/pages/*', pages.serve({ ... }))
  //
  // You can use other route patterns, as long as req.params[0] contains the
  // page slug.
  //
  // self.serve will automatically prepend a / to the slug if
  // req.params[0] does not contain one.
  //
  // The page object is passed to the Nunjucks type as `page`.
  //
  // If you want to also load all areas on the "global" page, for instance
  // to fetch shared headers and footers used across a site, supply a
  // `load` callback:
  //
  // app.get('/pages/*', pages.serve({ load: [ 'global' ] }, ...))
  //
  // The page with the slug `global` then becomes visible to the Nunjucks
  // type as `global`. Note that it may not exist yet, in which case
  // `global` is not set. Your type code must allow for this.
  //
  // You can include functions in the load: array. If you do so, those
  // functions are invoked as callbacks, and receive 'req' as their first
  // parameter. They should add additional page objects as properties of the
  // req.extras object, then invoke the callback they receive as their
  // second parameter with null, or with an error if they have failed in a
  // way that should result in a 500 error. All such extra pages are made
  // visible to Nunjucks. For instance, if you load req.extras.department,
  // then a variable named department containing that page is visible to Nunjucks.
  //
  // It is is also acceptable to pass a single function rather than an
  // array as the `load` property.
  //
  // The type name used to render the page is taken from
  // the type property of the req.page object. You will need to set the
  // directory from which page type templates are loaded:
  //
  // app.get('*', pages.serve({ typePath: __dirname + '/views/pages' })
  //
  // You can also override individual type paths. Any paths you don't
  // override continue to respect typePath. Note that you are still
  // specifying a folder's path, which must contain a nunjucks type
  // named home.html to render a page with that type property:
  //
  // app.get('*', pages.serve({ ..., typePaths: { home: __dirname + '/views/pages' } })
  //
  // In the event the page slug requested is not found, the notfound type
  // is rendered. You can override the notfound type path like any other.
  //
  // Loaders can access the page loaded by `page.serve` as `req.page`. This will
  // be null if no page slug matched the URL exactly.  However, if there is a page
  // that matches a leading portion of the URL when followed by `/`, that page
  // is also made available as `req.bestPage`. In this case the remainder of the
  // URL after the slug of the best page is returned as `req.remainder`. If more
  // than one page partially matches the URL the longest match is provided.
  //
  // Loaders can thus implement multiple-page experiences of almost any complexity
  // by paying attention to `req.remainder` and choosing to set `req.type` to
  // something that suits their purposes. If `req.type` is set by a loader it is
  // used instead of the original type of the page to select a template. Usually this
  // process begins by examining `req.bestPage.type` to determine whether it is suitable
  // for this treatment (a blog page, for example, might need to implement virtual
  // subpages for articles in this way).
  //
  // Loaders can also set req.page to req.bestPage, and should do so when electing
  // to accept a partial match, because this makes the page available to templates.
  //
  // Page type templates will want to render areas, passing along the slug and the
  // edit permission flag:
  //
  // {{ aposArea({ slug: slug + ':main', area: page.main, edit: edit }) }}
  //
  // {{ aposArea({ slug: 'global:footer', area: global.footer, edit: edit }) }}
  //
  // You can access all properties of the page via the 'page' object. Any pages
  // added to extras by `load` callbacks are also visible, like `global` above.
  //
  // If you want to create pages dynamically when nonexistent page slugs are visited,
  // you can supply a notfound handler:
  //
  // // Just create an empty page object like a wiki would
  // app.get('*', pages.serve({
  //   notfound: function(req, callback) {
  //     req.page = { areas: {} };
  //     callback(null);
  //   }
  // });
  //
  // If you do not set req.page the normal page-not-found behavior is applied.
  // Make sure you specify at least an areas property. If you do not supply a
  // type property, 'default' is assumed.

  self.serve = function(options) {

    if(!options) {
      options = {};
    }
    _.defaults(options, {
      root: ''
    });

    return function(req, res) {

      req.extras = {};
      return async.series([page, permissions, relatives, load, notfound], main);

      function page(callback) {
        // Get content for this page
        req.slug = req.params[0];
        if ((!req.slug.length) || (req.slug.charAt(0) !== '/')) {
          req.slug = '/' + req.slug;
        }
        apos.getPage(req.slug, function(e, page, bestPage, remainder) {
          if (e) {
            return callback(e);
          }

          // Set on exact slug matches only

          // "What if there is no page?" We'll note that later
          // and send the 404 type. We still want to load all
          // the global stuff first
          req.page = page;

          // Set on partial slug matches followed by a / and on
          // exact matches as well
          req.bestPage = bestPage;

          // Set to the empty string on exact matches, otherwise
          // to the portion of the URL after the slug of req.bestPage
          req.remainder = remainder;

          if (req.bestPage) {
            req.bestPage.url = options.root + req.bestPage.slug;
          }

          return callback(null);

        });
      }

      function permissions(callback) {
        // 404 in progress
        if (!req.bestPage) {
          return callback(null);
        }

        // Are we cool enough to view and/or edit this page?
        async.series([checkView, checkEdit], callback);

        function checkView(callback) {
          return apos.permissions(req, 'view-page', req.bestPage, function(err) {
            // If there is a permissions error then note that we are not
            // cool enough to see the page, which triggers the appropriate
            // error type.
            if (err) {
              if (req.user) {
                req.insufficient = true;
              } else {
                req.loginRequired = true;
              }
            }
            return callback(null);
          });
        }

        function checkEdit(callback) {
          return apos.permissions(req, 'edit-page', req.bestPage, function(err) {
            // If there is no permissions error then note that we are cool
            // enough to edit the page
            req.edit = !err;
            return callback(null);
          });
        }
      }


      function relatives(callback) {
        if(!req.bestPage) {
          return callback(null);
        }
        async.series([
          function(callback) {
            return self.getAncestors(req.bestPage, options, function(err, ancestors) {
              req.bestPage.ancestors = ancestors;
              return callback(err);
            });
          },
          function(callback) {
            return self.getDescendants(req.bestPage, options, function(err, children) {
              req.bestPage.children = children;
              return callback(err);
            });
          }
        ], callback);
      }

      function load(callback) {
        // Get any shared pages like global footers, also
        // invoke load callbacks if needed

        var load = options.load ? options.load : [];

        // Be tolerant if they pass just one function
        if (typeof(load) === 'function') {
          load = [ load ];
        }

        // Turn any slugs into callbacks to fetch those slugs.
        // This is a little lazy: if we turn out to need multiple
        // pages of shared stuff we could coalesce them into a
        // single mongo query. However we typically don't, or
        // we're loading some of them only in certain situations.
        // So let's not prematurely optimize

        load = load.map(function(item) {
          if (typeof(item) !== 'function') {
            return function(callback) {
              apos.getPage(item, function(err, page) {
                if (err) {
                  return callback(err);
                }
                // Provide an object with an empty areas property if
                // the page doesn't exist yet. This simplifies page type templates
                req.extras[item] = page ? page : { areas: [] };
                return callback(null);
              });
            };
          } else {
            // Already a callback, now wrap it in a function that can
            // see the req variable
            return function(callback) {
              return item(req, callback);
            };
          }
        });

        return async.parallel(load, callback);
      }

      function notfound(callback) {
        // Implement the automatic redirect mechanism for pages whose
        // slugs have changed, unless an alternate mechanism has been specified
        if (!req.page) {
          if (options.notfound) {
            return options.notfound(req, function(err) {
              return callback(err);
            });
          } else {
            // Check for a redirect from an old slug before giving up
            apos.redirects.findOne({from: req.slug }, function(err, redirect) {
              if (redirect) {
                return res.redirect(options.root + redirect.to);
              } else {
                return callback(null);
              }
            });
          }
        } else {
          return callback(null);
        }
      }

      function main(err) {
        var providePage = true;
        // Rendering errors isn't much different from
        // rendering other stuff. We still get access
        // to shared stuff loaded via `load`.

        // If the load functions already picked a type respect it,
        // whether it is on the allowed list for manual type choices
        // or not. Otherwise implement standard behaviors

        if (!req.type) {
          if (err) {
            req.type = 'serverError';
            res.statusCode = 500;
            providePage = false;
          } else if (req.loginRequired) {
            req.type = 'loginRequired';
            providePage = false;
          } else if (req.insufficient) {
            req.type = 'insufficient';
            providePage = false;
          } else if (req.page) {
            // Make sure the type is allowed
            req.type = req.page.type;
            if (!_.some(aposPages.types, function(item) {
              return item.name === req.type;
            })) {
              req.type = 'default';
            }
          } else {
            res.statusCode = 404;
            req.type = 'notfound';
            providePage = false;
          }
        }

        if (req.type === undefined) {
          // Supply a default type name
          req.type = 'default';
        }

        var args = {
          edit: req.edit,
          slug: req.slug,
          page: providePage ? req.page : null,
          user: req.user
        };

        _.defaults(args, req.extras);

        var path = __dirname + '/views/' + req.type + '.html';
        if (options.templatePath) {
          path = options.templatePath + '/' + req.type + '.html';
        }
        if (options.templatePaths) {
          if (options.templatePaths[type]) {
            path = options.templatePaths[type] + '/' + req.type + '.html';
          }
        }
        return res.send(apos.partial(path, args));
      }
    };
  };

  // You can also call with just the page and callback arguments
  self.getAncestors = function(page, options, callback) {
    if (!callback) {
      callback = options;
      options = {};
    }
    if(!options) {
      options = {};
    }
    _.defaults(options, {
      root: ''
    });

    var paths = [];
    if (page.path) {
      var components = page.path.split('/');
      var path = '';
      _.each(components, function(component) {
        path += component;
        // Don't redundantly load ourselves
        if (path === page.path) {
          return;
        }
        paths.push(path);
        path += '/';
      });
      // Get everything about the related pages except
      // for their actual items, which would be expensive.
      // Sorting by path works because longer strings sort
      // later than shorter prefixes
      return apos.pages.find({ path: { $in: paths } }, { items: 0 }).sort( { path: 1 }).toArray(function(err, pages) {
        if (err) {
          return callback(err);
        }
        _.each(pages, function(page) {
          page.url = options.root + page.slug;
        })
        return callback(null, pages);
      });
    }
    return callback(null);
  };

  // You may skip the options parameter and pass just page and callback
  self.getDescendants = function(page, options, callback) {
    if (!callback) {
      callback = options;
      options = {};
    }
    if(!options) {
      options = {};
    }
    _.defaults(options, {
      root: ''
    });


    var depth = options.depth;
    // Careful, let them specify a depth of 0 but still have a good default
    if (depth === undefined) {
      depth = 1;
    }

    apos.pages.find(
      {
        path: new RegExp('^' + RegExp.quote(page.path + '/')),
        level: { $gt: page.level, $lte: page.level + depth }
      },
      { items: 0 }
    ).
    sort( { level: 1, rank: 1 } ).
    toArray(function(err, pages) {
      if (err) {
        return callback(err);
      }
      var children = [];
      var pagesByPath = {};
      _.each(pages, function(page) {
        page.children = [];
        page.url = options.root + page.slug;
        pagesByPath[page.path] = page;
        var last = page.path.lastIndexOf('/');
        var parentPath = page.path.substr(0, last);
        if (pagesByPath[parentPath]) {
          pagesByPath[parentPath].children.push(page);
        } else {
          children.push(page);
        }
      });
      return callback(null, children);
    });
  };

    // Return a page type object if one was configured for the given type name.
  // JavaScript doesn't iterate over object properties in a defined order,
  // so we maintain the list of types as a flat array. This convenience method
  // prevents this from being inconvenient and allows us to choose to do more
  // optimization later.

  self.getType = function(name) {
    return _.find(aposPages.types, function(item) {
      return item.name === name;
    });
  };

  // Note that page types passed in should have a name property
  self.addType = function(typeArg) {
    // Do this dance carefully so that the group's properties are
    // applied first and the type's properties are allowed to override them
    var type = { group: typeArg.group };
    extend(true, type, aposPages.groups[type.group]);
    extend(true, type, typeArg);
    aposPages.types.push(type);
  };

  // Add a group (a superclass of page types) that many page types might
  // specify via their group property, such as ".group='blog'". Any other
  // properties of the group are then merged with the properties of
  // types in that group. A similar merge is also carried out on the
  // browser side, allowing both client- and server-side code to
  // apply shared properties to all types in the same group. Note that
  // groups must be added before any types that use them, so you'll be
  // calling pages.addType

  self.addGroup = function(name, group) {
    aposPages.groups[name] = group;
  };

  // Also note .addGroup and .addType for scenarios where
  // other modules need to be configured after pages and still
  // contribute the implementation of more types

  if (!options.types) {
    options.types = [ { name: 'default', label: 'Default' } ];
  }

  self.groups = [];
  self.types = [];

  _.each(options.groups || [], function(group) {
    self.addGroup(group);
  })

  _.each(options.types, function(type) {
    self.addType(type);
  });

  if (options.ui === undefined) {
    options.ui = true;
  }

  // For visibility in other scopes
  self.options = options;

  function determineType(req) {
    var typeName = req.body.type;
    type = aposPages.getType(typeName);
    if (!type) {
      typeName = 'default';
      type = aposPages.getType(typeName);
    }
    return type;
  }

  function addSanitizedTypeData(req, page, type, callback) {
    // Allow for sanitization of data submitted for specific page types.
    // If there is no sanitize function assume there is no data for safety
    if (type.settings && type.settings.sanitize) {
      console.log('there is a sanitizer');
      type.settings.sanitize(req.body[type.name] || {}, function(err, data) {
        if (err) {
          return callback(err);
        } else {
          page[type.name] = data;
          return callback(null);
        }
      });
    } else {
      return callback(null);
    }
  }

  // Make sure that aposScripts and aposStylesheets summon our
  // browser-side UI assets for managing pages

  if (options.ui) {
    apos.scripts.push('/apos-pages/js/pages.js');

    apos.stylesheets.push('/apos-pages/css/pages.css');

    apos.templates.push(__dirname + '/views/newPageSettings');
    apos.templates.push(__dirname + '/views/editPageSettings');

    app.post('/apos-pages/new', function(req, res) {
      var parent;
      var page;
      var parentSlug;
      var title;
      var type;
      var nextRank;

      title = req.body.title.trim();
      // Validation is annoying, automatic cleanup is awesome
      if (!title.length) {
        title = 'New Page';
      }

      type = determineType(req);

      async.series([ getParent, permissions, getNextRank, insertPage ], sendPage);

      function getParent(callback) {
        parentSlug = req.body.parent;
        return apos.getPage(parentSlug, function(err, parentArg) {
          parent = parentArg;
          if ((!err) && (!parent)) {
            err = 'Bad parent';
          }
          return callback(err);
        });
      }

      function permissions(callback) {
        return apos.permissions(req, 'add-page', parent, function(err) {
          // If there is no permissions error then note that we are cool
          // enough to edit the page
          return callback(err);
        });
      }


      // TODO: there's a potential race condition here. It's not a huge deal,
      // having two pages with the same rank just leads to them sorting
      // randomly, the page tree is not destroyed. But we should have a
      // cleanup task or a lock mechanism
      function getNextRank(callback) {
        self.getDescendants(parent, { depth: 1}, function(err, children) {
          if (err) {
            return callback(err);
          }
          nextRank = 1;
          nextRank = _.reduce(children, function(memo, child) {
            if (child.rank >= memo) {
              memo = child.rank + 1;
            }
            return memo;
          }, nextRank);
          return callback(null);
        });
      }

      function insertPage(callback) {
        page = { title: title, type: type.name, level: parent.level + 1, areas: {}, path: parent.path + '/' + apos.slugify(title), slug: addSlashIfNeeded(parentSlug) + apos.slugify(title), rank: nextRank };
        addSanitizedTypeData(req, page, type, putPage);
        function putPage(err) {
          if (err) {
            return callback(err);
          }
          apos.putPage(page.slug, page, callback);
        }
      }

      function addSlashIfNeeded(path) {
        path += '/';
        path = path.replace('//', '/');
        return path;
      }

      function sendPage(err) {
        if (err) {
          res.statusCode = 500;
          return res.send('error');
        }
        return res.send(JSON.stringify(page));
      }
    });

    app.post('/apos-pages/edit', function(req, res) {

      var page;
      var originalSlug;
      var slug;
      var title;
      var type;

      title = req.body.title.trim();
      // Validation is annoying, automatic cleanup is awesome
      if (!title.length) {
        title = 'Untitled Page';
      }

      type = determineType(req);

      originalSlug = req.body.originalSlug;
      slug = req.body.slug;

      slug = apos.slugify(slug, { allowed: '/' });
      // Make sure they don't turn it into a virtual page
      if (!slug.match(/^\//)) {
        slug = '/' + slug;
      }
      // Eliminate double slashes
      slug = slug.replace(/\/+/g, '/');
      // Eliminate trailing slashes
      slug = slug.replace(/\/$/, '');

      async.series([ getPage, permissions, updatePage, redirect, updateDescendants ], sendPage);

      function getPage(callback) {

        return apos.getPage(originalSlug, function(err, pageArg) {
          page = pageArg;
          if ((!err) && (!page)) {
            err = 'Bad page';
          }
          return callback(err);
        });
      }

      function permissions(callback) {
        return apos.permissions(req, 'edit', page, function(err) {
          // If there is no permissions error then note that we are cool
          // enough to edit the page
          return callback(err);
        });
      }

      function updatePage(callback) {
        page.title = title;
        page.slug = slug;
        console.log('in updatePage the type is...');
        console.log(type);
        page.type = type.name;

        if ((slug !== originalSlug) && (originalSlug === '/')) {
          return callback('Cannot change the slug of the home page');
        }

        addSanitizedTypeData(req, page, type, putPage);

        function putPage(err) {
          if (err) {
            return callback(err);
          }
          return apos.putPage(originalSlug, page, callback);
        }
      }

      function redirect(callback) {
        apos.updateRedirect(originalSlug, slug, callback);
      }

      // If our slug changed, then our descendants' slugs should
      // also change, if they are still similar. You can't do a
      // global substring replace in MongoDB the way you can
      // in MySQL, so we need to fetch them and update them
      // individually. async.mapSeries is a good choice because
      // there may be zillions of descendants and we don't want
      // to choke the server. We could use async.mapLimit, but
      // let's not get fancy just yet

      function updateDescendants(callback) {
        if (originalSlug === slug) {
          return callback(null);
        }
        var matchParentSlugPrefix = new RegExp('^' + RegExp.quote(originalSlug + '/'));
        apos.pages.find({ slug: matchParentSlugPrefix }, { items: 0 }).toArray(function(err, descendants) {
          if (err) {
            return callback(err);
          }
          var newSlugPrefix = slug + '/';
          async.mapSeries(descendants, function(descendant, callback) {
            var newSlug = descendant.slug.replace(matchParentSlugPrefix, newSlugPrefix);
            return apos.pages.update({ slug: descendant.slug }, { $set: { slug: newSlug } }, callback);
          }, callback);
        });
      }

      function sendPage(err) {
        if (err) {
          res.statusCode = 500;
          return res.send('error');
        }
        return res.send(JSON.stringify(page));
      }
    });

    app.post('/apos-pages/delete', function(req, res) {

      async.series([ getPage, permissions, getParent, checkChildren, deletePage], respond);

      var parent;
      var page;
      var parentSlug;
      var title;
      var nextRank;

      function getPage(callback) {
        pageSlug = req.body.slug;
        return apos.getPage(pageSlug, function(err, pageArg) {
          page = pageArg;
          if(!page) {
            return callback('Not Found');
          }
          return callback(err);
        });
      }

      function permissions(callback) {
        return apos.permissions(req, 'add-page', parent, function(err) {
          // If there is no permissions error then note that we are cool
          // enough to edit the page
          return callback(err);
        });
      }

      function getParent(callback) {
        self.getAncestors(page, {}, function(err, ancestors) {
          if(!ancestors.length) {
            return callback('Cannot remove home page');
          }
          parent = ancestors.pop();
          return callback(err);
        });
      }

      function checkChildren(callback) {
        self.getDescendants(page, {depth: 1}, function(err, descendants) {
          if(descendants.length) {
            return callback('Remove child pages first');
          }
          return callback(err);
        });
      }

      function deletePage(callback) {
        apos.pages.remove({slug: page.slug}, callback);
      }

      function respond(err) {
        if (err) {
          return res.send(JSON.stringify({
            status: err
          }));
        }
        return res.send(JSON.stringify({
          status: 'ok',
          parent: parent.slug
        }));
      }
    });

    // Serve our assets. This is the final route so it doesn't
    // beat out the rest
    app.get('/apos-pages/*', apos.static(__dirname + '/public'));

    apos.addLocal('aposEditPage', function(options) {
      if (!options.root) {
        options.root = '/';
      }
      if (!options.types) {
        options.types = aposPages.types;
      }
      // Pass the options as one argument so they can be passed on
      return apos.partial('editPage.html', { args: options }, __dirname + '/views');
    });
  }

  async.series([ pathIndex ], callback);

  function pathIndex(callback) {
    // Unique and sparse together mean that many pages can have no path,
    // but any paths that do exist must be unique
    return apos.pages.ensureIndex({ path: 1 }, { safe: true, unique: true, sparse: true }, callback);
  }
}
