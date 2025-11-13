import React from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'

export function withRouter(Component) {
    return function ComponentWithRouterProp(props) {
        let navigate = useNavigate()
        let location = useLocation()
        let params = useParams()

        return React.createElement(Component, {
            ...props,
            router: { navigate, location, params },
            history: { push: navigate, replace: (path) => navigate(path, { replace: true }), location }
        })
    }
}
