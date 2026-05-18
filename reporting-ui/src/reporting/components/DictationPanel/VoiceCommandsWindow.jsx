import { useState, useEffect, useCallback, useMemo } from 'react';
import { VOICE_COMMAND_GROUPS, getSectionAliases } from '../../data/voiceCommandData';

/**
 * VoiceCommandsWindow — Voice Commands reference pop-out window.
 *
 * Renders grouped, expandable command cards inside a Document PiP
 * (or popup-fallback) window. The window is opened by HamburgerMenu
 * and this component manages the content that is portalled into it.
 *
 * Features:
 *  - Category groups that are collapsible (default: expanded)
 *  - Individual command cards that expand to show description + alias chips
 *  - Dynamic "Go to [section]" aliases loaded from the active template
 *  - "Coming soon" badge for not-yet-implemented commands
 *  - Compact, scannable layout for use as a quick reference
 */
export default function VoiceCommandsWindow({ onClose }) {
  // Load dynamic section aliases on mount (fresh each time window opens)
  const sectionAliases = useMemo(() => getSectionAliases(), []);

  // Category collapse state — all expanded by default
  const [collapsedCategories, setCollapsedCategories] = useState({});

  // Individual card expand state — all collapsed by default
  const [expandedCards, setExpandedCards] = useState({});

  const toggleCategory = useCallback((category) => {
    setCollapsedCategories((prev) => ({
      ...prev,
      [category]: !prev[category],
    }));
  }, []);

  const toggleCard = useCallback((cardKey) => {
    setExpandedCards((prev) => ({
      ...prev,
      [cardKey]: !prev[cardKey],
    }));
  }, []);

  // Close on Escape
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="vc-window" id="voice-commands-window">
      {/* Header */}
      <div className="vc-window__header">
        <div className="vc-window__title">
          {/* Megaphone with curved sound waves — matches hamburger menu icon */}
          <svg className="vc-window__title-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 9h4l5-4v14l-5-4H3V9z" />
            <path d="M15.5 8.5c.8.8 1.3 2 1.3 3.5s-.5 2.7-1.3 3.5" />
            <path d="M18.5 5.5c1.7 1.7 2.8 4 2.8 6.5s-1.1 4.8-2.8 6.5" />
          </svg>
          Voice Commands
        </div>
      </div>


      {/* Body — scrollable command list */}
      <div className="vc-window__body">
        {VOICE_COMMAND_GROUPS.map((group) => {
          const isCategoryCollapsed = collapsedCategories[group.category] || false;

          return (
            <div className="vc-category" key={group.category}>
              {/* Category header — clickable to collapse */}
              <button
                className="vc-category__header"
                onClick={() => toggleCategory(group.category)}
                aria-expanded={!isCategoryCollapsed}
                id={`vc-category-${group.category.toLowerCase()}`}
              >
                <svg
                  className={`vc-category__chevron ${isCategoryCollapsed ? 'vc-category__chevron--collapsed' : ''}`}
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
                <span className="vc-category__label">{group.category}</span>
                <span className="vc-category__count">{group.commands.length}</span>
              </button>

              {/* Category body — collapsible */}
              {!isCategoryCollapsed && (
                <div className="vc-category__body">
                  {group.commands.map((cmd) => {
                    const cardKey = `${group.category}::${cmd.name}`;
                    const isExpanded = expandedCards[cardKey] || false;

                    // Resolve aliases: dynamic for section commands, static otherwise
                    const resolvedAliases = cmd.dynamicAliases
                      ? sectionAliases
                      : cmd.aliases || [];

                    return (
                      <div
                        className={`vc-card ${isExpanded ? 'vc-card--expanded' : ''} ${cmd.notImplemented ? 'vc-card--not-implemented' : ''}`}
                        key={cardKey}
                      >
                        {/* Card header — clickable to expand */}
                        <button
                          className="vc-card__header"
                          onClick={() => toggleCard(cardKey)}
                          aria-expanded={isExpanded}
                          id={`vc-card-${cmd.name.toLowerCase().replace(/[\s[\]]/g, '-')}`}
                        >
                          <svg
                            className={`vc-card__chevron ${isExpanded ? 'vc-card__chevron--expanded' : ''}`}
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <polyline points="9 18 15 12 9 6" />
                          </svg>
                          <span className="vc-card__name">{cmd.name}</span>
                          {cmd.notImplemented && (
                            <span className="vc-card__badge--soon">Coming soon</span>
                          )}
                        </button>

                        {/* Card body — expanded content */}
                        {isExpanded && (
                          <div className="vc-card__body">
                            <div className="vc-card__description">{cmd.description}</div>

                            {resolvedAliases.length > 0 && (
                              <div className="vc-card__aliases">
                                <span className="vc-card__aliases-label">Aliases:</span>
                                <div className="vc-card__alias-list">
                                  {resolvedAliases.map((alias, i) => (
                                    <span className="vc-card__alias" key={i}>
                                      {alias}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}

                            {cmd.dynamicAliases && resolvedAliases.length === 0 && (
                              <div className="vc-card__aliases">
                                <span className="vc-card__aliases-label vc-card__aliases-label--empty">
                                  Section names are determined by the loaded template.
                                </span>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
