/*

Ext Gantt Pro 4.2.7
Copyright(c) 2009-2016 Bryntum AB
http://bryntum.com/contact
http://bryntum.com/license

*/
// https://www.sencha.com/forum/showthread.php?310798-Editing-is-broken-after-view-refresh
Ext.define('Sch.patches.TableView2', {
    extend     : 'Sch.util.Patch',

    target     : 'Ext.view.Table',

    minVersion : '6.0.2',
    maxVersion : '6.2.0',

    overrides  : {

        privates : {
            setActionableMode: function (enabled, position) {
                var me = this,
                    navModel = me.getNavigationModel(),
                    activeEl,
                    actionables = me.grid.actionables,
                    len = actionables.length,
                    i, record, column,
                    isActionable = false,
                    lockingPartner;
                // No mode change.
                // ownerGrid's call will NOT fire mode change event upon false return.
                if (me.actionableMode === enabled) {
                    // If we're not actinoable already, or (we are actionable already at that position) return false.
                    // Test using mandatory passed position because we may not have an actionPosition if we are
                    // the lockingPartner of an actionable view that contained the action position.
                    //
                    // If we being told to go into actionable mode but at another position, we must continue.
                    // This is just actionable navigation.
                    if (!enabled || position.isEqual(me.actionPosition)) {
                        return false;
                    }
                }
                // If this View or its lockingPartner contains the current focus position, then make the tab bumpers tabbable
                // and move them to surround the focused row.
                if (enabled) {
                    if (position && (position.view === me || (position.view === (lockingPartner = me.lockingPartner) && lockingPartner.actionableMode))) {
                        isActionable = me.activateCell(position);
                    }
                    // Did not enter actionable mode.
                    // ownerGrid's call will NOT fire mode change event upon false return.
                    return isActionable;
                } else {
                    // Capture before exiting from actionable mode moves focus
                    activeEl = Ext.fly(Ext.Element.getActiveElement());
                    // Blur the focused descendant, but do not trigger focusLeave.
                    // This is so that when the focus is restored to the cell which contained
                    // the active content, it will not be a FocusEnter from the universe.
                    if (me.el.contains(activeEl)) {
                        // Row to return focus to.
                        record = (me.actionPosition && me.actionPosition.record) || me.getRecord(activeEl);
                        column = me.getHeaderByCell(activeEl.findParent(me.getCellSelector()));
                        // Do not allow focus to fly out of the view when the actionables are deactivated (and blurred/hidden)
                        // Restore focus to the cell in which actionable mode is active.
                        if (!position) {
                            position = new Ext.grid.CellContext(me).setPosition(record || 0, column || 0);
                        }

                        // Ext.grid.NavigationModel#onFocusMove will NOT react and navigate because the actionableMode
                        // flag is still set at this point.

                        // HACK This focus will trigger completeEdit and may cause view refresh. In this case view will
                        // try to save and restore actionable mode, we should prevent that by raising a special flag that
                        // we can check in restoreFocus method (generated by saveFocus) and decide if we should skip that
                        // Covered by 096_taskeditor in gantt
                        me._leavingActionableMode = true;
                        position.getCell().focus();
                        me._leavingActionableMode = false;
                        // END HACK

                        // Let's update the activeEl after focus here
                        activeEl = Ext.fly(Ext.Element.getActiveElement());
                        // If that focus triggered handlers (eg CellEditor after edit handlers) which
                        // programatically moved focus somewhere, and the target cell has been unfocused, defer to that,
                        // null out position, so that we do not navigate to that cell below.
                        // See EXTJS-20395
                        if (!(me.el.contains(activeEl) && activeEl.is(me.getCellSelector()))) {
                            position = null;
                        }
                    }
                    // We are exiting actionable mode.
                    // Tell all registered Actionables about this fact if they need to know.
                    for (i = 0; i < len; i++) {
                        if (actionables[i].deactivate) {
                            actionables[i].deactivate();
                        }
                    }
                    // If we had begun action (we may be a dormant lockingPartner), make any tabbables untabbable
                    if (me.actionRow) {
                        me.actionRow.saveTabbableState({
                            skipSelf: true,
                            includeSaved: false
                        });
                    }
                    if (me.destroyed) {
                        return false;
                    }
                    // These flags MUST be set before focus restoration to the owning cell.
                    // so that when Ext.grid.NavigationModel#setPosition attempts to exit actionable mode, we don't recurse.
                    me.actionableMode = me.ownerGrid.actionableMode = false;
                    me.actionPosition = navModel.actionPosition = me.actionRow = null;
                    // Push focus out to where it was requested to go.
                    if (position) {
                        navModel.setPosition(position);
                    }
                }
            }
        },

        saveFocusState: function() {
            var me = this,
                store = me.dataSource,
                actionableMode = me.actionableMode,
                navModel = me.getNavigationModel(),
                focusPosition = actionableMode ? me.actionPosition : navModel.getPosition(true),
                activeElement = Ext.Element.getActiveElement(true),
                focusCell = focusPosition && focusPosition.view === me && focusPosition.getCell(),
                refocusRow, refocusCol;
            // The navModel may return a position that is in a locked partner, so check that
            // the focusPosition's cell contains the focus before going forward.
            if (focusCell && focusCell.contains(activeElement)) {
                // Separate this from the instance that the nav model is using.
                focusPosition = focusPosition.clone();
                // While we deactivate the focused element, suspend focus processing on it.
                activeElement.suspendFocusEvents();
                // Suspend actionable mode.
                // Each Actionable must silently save its state
                // ready to resume when focus can be restored.
                if (actionableMode) {
                    me.suspendActionableMode();
                } else // Clear position, otherwise the setPosition onthe other side
                // will be rejected as a no-op if the resumption position is logically
                // equivalent.
                {
                    navModel.setPosition();
                }
                // Do not leave the element in tht state in case refresh fails, and restoration
                // closeure not called.
                activeElement.resumeFocusEvents();
                // The following function will attempt to refocus back in the same mode to the same cell
                // as it was at before based upon the previous record (if it's still inthe store), or the row index.
                return function() {
                    // If we still have data, attempt to refocus in the same mode.
                    if (store.getCount()) {
                        // Adjust expectations of where we are able to refocus according to what kind of destruction
                        // might have been wrought on this view's DOM during focus save.
                        refocusRow = Math.min(focusPosition.rowIdx, me.all.getCount() - 1);
                        refocusCol = Math.min(focusPosition.colIdx, me.getVisibleColumnManager().getColumns().length - 1);
                        focusPosition = new Ext.grid.CellContext(me).setPosition(store.contains(focusPosition.record) ? focusPosition.record : refocusRow, refocusCol);
                        // HACK
                        if (actionableMode && !me._leavingActionableMode) {
                        // END HACK
                            me.resumeActionableMode(focusPosition);
                        } else {
                            // Pass "preventNavigation" as true so that that does not cause selection.
                            navModel.setPosition(focusPosition, null, null, null, true);
                        }
                    } else // No rows - focus associated column header
                    {
                        focusPosition.column.focus();
                    }
                };
            }
            return Ext.emptyFn;
        }
    }
});