/* global Ext MetricsManager Constants Rally _ */
Ext.define("CArABU.app.TSApp", {
    extend: 'Rally.app.App',
    componentCls: 'app',
    defaults: { margin: 10 },
    layout: {
        type: 'vbox',
        align: 'stretch'
    },
    items: [{
        xtype: 'container',
        layout: 'hbox',
        items: [{
            xtype: 'container',
            flex: 1
        }]
    }],
    integrationHeaders: {
        name: "CArABU.app.TSApp"
    },
    piTypePath: undefined,

    onTimeboxScopeChange: function(newTimeboxScope) {
        this.callParent(arguments);
        // TODO (tj) Ideally, we would just refresh the grid, but it is not clear to me how
        // to do that with a rallygridboard and preserve the timebox filter AND any existing
        // advanced filters from the filter plugin. Instead, if the page level timebox changes, just
        // relaunch the app.
        this.launch();
    },

    initLowestPortfolioItemTypeName: function() {
        return Ext.create('Rally.data.wsapi.Store', {
            model: Ext.identityFn('TypeDefinition'),
            fetch: ['Name', 'Ordinal', 'TypePath'],
            sorters: {
                property: 'Ordinal',
                direction: 'ASC'
            },
            filters: [{
                    property: 'Creatable',
                    operator: '=',
                    value: 'true'
                },
                {
                    property: 'Parent.Name',
                    operator: '=',
                    value: 'Portfolio Item'
                }
            ]
        }).load().then({
            scope: this,
            success: function(results) {
                this.lowestPortfolioItemTypeName = results[0].get('Name');
                this.storyFetchFields = Constants.STORY_FETCH_FIELDS;
                this.storyFetchFields.push(this.lowestPortfolioItemTypeName);
            }
        });
    },

    getLowestPortfolioItemTypeName: function() {
        return this.lowestPortfolioItemTypeName || 'Feature'
    },

    launch: function() {
        this.initLowestPortfolioItemTypeName().then({
            scope: this,
            success: this.loadPrimaryStories
        });
    },

    loadPrimaryStories: function() {
        var pageFilters = [];
        var timeboxScope = this.getContext().getTimeboxScope();
        if (timeboxScope) {
            pageFilters.push(timeboxScope.getQueryFilter());
        }
        Ext.create('Rally.data.wsapi.Store', {
            model: 'hierarchicalrequirement',
            autoLoad: true,
            filters: pageFilters,
            listeners: {
                scope: this,
                load: function(store, records) {
                    MetricsManager.createDependencyStore(records)
                        .then({
                            scope: this,
                            success: function(store) {
                                this.addGrid(store)
                            }
                        })
                }
            },
            fetch: this.storyFetchFields
        });
    },

    addGrid: function(store) {
        var grid = this.down('#grid');
        if (grid) {
            this.remove(grid);
        }

        this.add({
            xtype: 'rallygrid',
            itemId: 'grid',
            shouldShowRowActionsColumn: false,
            store: store,
            columnCfgs: this.getColumns(),
            listeners: {
                scope: this,
                itemclick: function(grid, record, item, index) {
                    console.log(record);
                }
            }
        })
    },

    getColumns: function() {
        return [{
                xtype: 'gridcolumn',
                text: 'Story',
                columns: this.getSubColumns(Constants.ID.STORY)
            },
            {
                xtype: 'gridcolumn',
                text: 'Predecessor',
                columns: this.getSubColumns(Constants.ID.PREDECESSOR)
            },
            {
                xtype: 'gridcolumn',
                text: 'Successor',
                columns: this.getSubColumns(Constants.ID.SUCCESSOR)
            }
        ]
    },
    getSubColumns: function(dataIndex) {
        return [{
                xtype: 'gridcolumn',
                text: 'ID',
                renderer: function(value, meta, record) {
                    try {
                        return record.get(dataIndex).get('FormattedID');
                    }
                    catch (exception) {
                        return '';
                    }
                }
            },
            {
                xtype: 'gridcolumn',
                text: 'Name',
                renderer: function(value, meta, record) {
                    try {
                        return record.get(dataIndex).get('Name');
                    }
                    catch (exception) {
                        return '';
                    }
                }
            },
            {
                xtype: 'gridcolumn',
                text: 'Project',
                renderer: function(value, meta, record) {
                    try {
                        return record.get(dataIndex).get('Project').Name;
                    }
                    catch (exception) {
                        return '';
                    }
                }
            },
            {
                xtype: 'gridcolumn',
                text: 'Iteration',
                scope: this,
                renderer: function(value, meta, record) {
                    var result;
                    switch (dataIndex) {
                        case Constants.ID.PREDECESSOR:
                            result = this.predecessorIterationRenderer(record);
                            break;
                        case Constants.ID.SUCCESSOR:
                            result = this.successorIterationRenderer(record);
                            break;
                        default:
                            result = this.primaryIterationRenderer(record);
                            break;
                    }
                    return result;
                }
            },
            {
                xtype: 'gridcolumn',
                text: this.lowestPortfolioItemTypeName,
                scope: this,
                renderer: function(value, meta, record) {
                    try {
                        return record.get(dataIndex).get(this.lowestPortfolioItemTypeName).Name;
                    }
                    catch (exception) {
                        return '';
                    }
                }
            },
        ]
    },

    primaryIterationRenderer: function(row) {
        var colorClass = Constants.CLASS.OK;
        try {
            var primaryIterationName = row.get(Constants.ID.STORY).get('Iteration').Name;
        }
        catch (ex) {
            primaryIterationName = Constants.LABEL.UNSCHEDULED;
            colorClass = Constants.CLASS.ERROR;
        }

        return this.colorsRenderer(primaryIterationName, colorClass);
    },

    predecessorIterationRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var predecessor = row.get(Constants.ID.PREDECESSOR);

        if (predecessor) {
            var colorClass = Constants.CLASS.OK;
            var primaryIteration = primaryStory.get('Iteration');
            var predecessorIteration = predecessor.get('Iteration');

            var predecessorIterationName;

            if (predecessorIteration && primaryIteration) {
                predecessorIterationName = predecessorIteration.Name;
                var primaryStartDate = primaryIteration.StartDate;
                var predecessorStartDate = predecessorIteration.StartDate;

                if (predecessorStartDate < primaryStartDate) {
                    // Predecessor scheduled before primary. OK
                }
                else if (predecessorStartDate == primaryStartDate) {
                    // Predecessor scheduled in same iteration as primary. Warn
                    colorClass = Constants.CLASS.WARNING;
                }
                else {
                    // Predecessor scheduled after primary (or not scheduled). Error
                    colorClass = Constants.CLASS.ERROR;
                }
            }
            else if (!predecessorIteration && primaryIteration) {
                // No predecessor iteration when there is a primary. Highlight as error
                predecessorIterationName = Constants.LABEL.UNSCHEDULED;
                colorClass = Constants.CLASS.ERROR;
            }
            else if (predecessorIteration && !primaryIteration) {
                // Predecessor but no primary, don't highlight the iteration name
                predecessorIterationName = predecessorIteration.Name;
            }
            else if (!predecessorIteration && !primaryIteration) {
                // display nothing
                predecessorIterationName = '';
            }

            result = this.colorsRenderer(predecessorIterationName, colorClass);
        }

        return result;
    },

    successorIterationRenderer: function(row) {
        var result;
        var primaryStory = row.get(Constants.ID.STORY);
        var dependency = row.get(Constants.ID.SUCCESSOR);

        if (dependency) {
            var colorClass = Constants.CLASS.OK;
            var primaryIteration = primaryStory.get('Iteration');
            var dependencyIteration = dependency.get('Iteration');

            var dependencyIterationName;

            if (dependencyIteration && primaryIteration) {
                dependencyIterationName = dependencyIteration.Name;
                var primaryStartDate = primaryIteration.StartDate;
                var dependencyStartDate = dependencyIteration.StartDate;

                if (dependencyStartDate > primaryStartDate) {
                    // dependency scheduled before primary. OK
                }
                else if (dependencyStartDate == primaryStartDate) {
                    // dependency scheduled in same iteration as primary. Warn
                    colorClass = Constants.CLASS.WARNING;
                }
                else {
                    // dependency scheduled after primary (or not scheduled). Error
                    colorClass = Constants.CLASS.ERROR;
                }
            }
            else if (!dependencyIteration && primaryIteration) {
                // No dependency iteration when there is a primary. Highlight as error
                dependencyIterationName = Constants.LABEL.UNSCHEDULED;
                colorClass = Constants.CLASS.ERROR;
            }
            else if (dependencyIteration && !primaryIteration) {
                // dependency but no primary, don't highlight the iteration name
                dependencyIterationName = dependencyIteration.Name;
            }
            else if (!dependencyIteration && !primaryIteration) {
                // display nothing
                dependencyIterationName = '';
            }

            result = this.colorsRenderer(dependencyIterationName, colorClass);
        }

        return result;
    },

    /**
     * value: String to display
     * cls: Extra class to add to the cell
     */
    colorsRenderer: function(value, cls) {
        return '<div class="status-color ' + cls + '">' + value + '</div>';
    }
});